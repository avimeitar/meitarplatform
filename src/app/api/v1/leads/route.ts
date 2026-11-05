// POST /api/v1/leads: leads from outside systems (the website, landing pages, lead vendors, Facebook and
// Instagram Lead Ads through Make or Zapier). Server to server, so there are no CORS headers.
// Auth: "Authorization: Bearer mk_..." or "X-Api-Key: mk_...". Keys are managed on the /intake screen.
import { createOrMergeLead } from "@/lib/crm/service";
import { hasDatabase, prisma } from "@/lib/db";
import { apiKeyFromHeaders, apiKeyMatches, mapLeadFields, NO_NAME, parseApiKey, RateLimiter, readLeadBody } from "@/lib/intake";
import { Recorder } from "@/lib/undo";

const PER_MINUTE = 120;
const store = globalThis as unknown as { __intakeLimiter?: RateLimiter };
const limiter = (store.__intakeLimiter ??= new RateLimiter(PER_MINUTE, 60_000));

function reply(status: number, body: Record<string, unknown>, headers: Record<string, string> = {}) {
  return Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });
}

function fail(status: number, error: string, headers?: Record<string, string>) {
  return reply(status, { ok: false, error }, headers);
}

const denied = (error: string) => fail(401, error, { "WWW-Authenticate": 'Bearer realm="leads"' });

function isUniqueViolation(err: unknown): boolean {
  return typeof err === "object" && err !== null && (err as { code?: unknown }).code === "P2002";
}

/** A project by id, name or full name. When the sender names no project, or one we don't know, the key's project is used. */
async function resolveProject(value: string | null, keyProjectId: string | null, warnings: string[]): Promise<string | null> {
  const fallback = async () => (keyProjectId ? ((await prisma.project.findUnique({ where: { id: keyProjectId }, select: { id: true } }))?.id ?? null) : null);
  if (!value) return fallback();
  const found =
    (await prisma.project.findUnique({ where: { id: value }, select: { id: true } })) ??
    (await prisma.project.findFirst({
      where: { OR: [{ name: { equals: value, mode: "insensitive" } }, { fullName: { equals: value, mode: "insensitive" } }] },
      orderBy: [{ active: "desc" }, { sortOrder: "asc" }],
      select: { id: true },
    }));
  if (found) return found.id;
  const id = await fallback();
  const known = await prisma.project.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { name: true }, take: 30 });
  warnings.push(
    `Unknown project "${value}". The lead was saved ${id ? "with this key's default project" : "without a project"}.` + (known.length ? ` Known projects: ${known.map((p) => p.name).join(", ")}.` : ""),
  );
  return id;
}

export async function POST(req: Request) {
  if (!hasDatabase()) return fail(503, "Lead intake is not available yet: the CRM has no database connected.");
  try {
    const rawKey = apiKeyFromHeaders(req.headers);
    if (!rawKey) return denied('Missing API key. Send it in the "Authorization: Bearer <key>" header or in the "X-Api-Key" header.');
    const prefix = parseApiKey(rawKey);
    const key = prefix ? await prisma.apiKey.findUnique({ where: { prefix } }) : null;
    if (!key || !apiKeyMatches(rawKey, key.hash)) return denied("Invalid API key. Check that the whole key was copied.");
    if (!key.active) return denied("This API key was revoked. Ask the CRM administrator for a new key.");

    const limit = limiter.hit(key.id);
    if (!limit.ok) return fail(429, `Too many requests: up to ${PER_MINUTE} per minute for each key. Try again in ${limit.retryAfter} seconds.`, { "Retry-After": String(limit.retryAfter) });
    await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });

    const body = await readLeadBody(req);
    if (!body.ok) return fail(body.status, body.error);
    const mapped = mapLeadFields(body.data);
    if (!mapped.ok) return fail(400, mapped.error);
    const { lead } = mapped;
    const warnings = [...mapped.warnings];
    const projectId = await resolveProject(lead.project, key.projectId, warnings);

    const input = {
      name: lead.name ?? NO_NAME,
      phone: lead.phone,
      email: lead.email,
      source: lead.source ?? key.source,
      projectId,
      owner: "auto" as const,
      consent: lead.consent,
      campaign: lead.campaign,
      page: lead.page,
      payload: body.data,
    };
    let result: Awaited<ReturnType<typeof createOrMergeLead>>;
    try {
      result = await prisma.$transaction((tx) => createOrMergeLead(tx, new Recorder(tx), input, null));
    } catch (err) {
      // The same new phone number arrived twice at once: the second request becomes an inquiry on the first lead.
      if (!isUniqueViolation(err)) throw err;
      console.warn("[intake] the same phone arrived twice at once; saving the second as an inquiry");
      result = await prisma.$transaction((tx) => createOrMergeLead(tx, new Recorder(tx), input, null));
    }
    if (!lead.name && !result.duplicate) warnings.push(`No name was sent, so the lead was saved as "${NO_NAME}" ("no name").`);

    return reply(result.duplicate ? 200 : 201, { ok: true, leadId: result.leadId, duplicate: result.duplicate, ...(warnings.length ? { warnings } : {}) });
  } catch (err) {
    console.error("[intake] could not take a lead", err);
    return fail(500, "Something went wrong on our side and the lead was not saved. Please try again in a moment.");
  }
}
