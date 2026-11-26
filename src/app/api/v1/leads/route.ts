// /api/v1/leads: leads from outside systems (the website, landing pages, lead vendors, Facebook and
// Instagram Lead Ads through Make or Zapier). Server to server, so there are no CORS headers.
// Auth: "Authorization: Bearer mk_...", "X-Api-Key: mk_...", or the key in the address (?key=mk_...), which is how a
// supplier's personal link works. Keys are managed on the /intake screen.
//   POST  one lead in the body (JSON or a form); fields in the address are taken too, the body wins.
//   GET   one lead in the address (?key=...&name=...&phone=...), for senders that can only call a link.
//         The link alone, without fields, only checks that it works: opening it in a browser says so.
import { createOrMergeLead } from "@/lib/crm/service";
import { hasDatabase, prisma } from "@/lib/db";
import { apiKeyFromRequest, apiKeyMatches, fieldsFromQuery, mapLeadFields, NO_NAME, parseApiKey, RateLimiter, readLeadBody, type Body } from "@/lib/intake";
import { placeholderSource, sourceForCode } from "@/lib/sourceCodes";
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

type ApiKeyRow = NonNullable<Awaited<ReturnType<typeof prisma.apiKey.findUnique>>>;

/** The key of the request, checked; or the reply that turns it away. */
async function authorize(req: Request, url: URL): Promise<{ key: ApiKeyRow } | { refused: Response }> {
  const rawKey = apiKeyFromRequest(req.headers, url);
  if (!rawKey) return { refused: denied('Missing API key. Send it in the "Authorization: Bearer <key>" header, in the "X-Api-Key" header, or in the address as ?key=<key>.') };
  const prefix = parseApiKey(rawKey);
  const key = prefix ? await prisma.apiKey.findUnique({ where: { prefix } }) : null;
  if (!key || !apiKeyMatches(rawKey, key.hash)) return { refused: denied("Invalid API key. Check that the whole key (or the whole link) was copied.") };
  if (!key.active) return { refused: denied("This API key was revoked. Ask the CRM administrator for a new key.") };
  const limit = limiter.hit(key.id);
  if (!limit.ok) return { refused: fail(429, `Too many requests: up to ${PER_MINUTE} per minute for each key. Try again in ${limit.retryAfter} seconds.`, { "Retry-After": String(limit.retryAfter) }) };
  return { key };
}

/** Saves one lead from the fields that were sent. */
async function take(key: ApiKeyRow, data: Body): Promise<Response> {
  await prisma.apiKey.update({ where: { id: key.id }, data: { lastUsedAt: new Date() } });
  const mapped = mapLeadFields(data);
  if (!mapped.ok) return fail(400, mapped.error);
  const { lead } = mapped;
  const warnings = [...mapped.warnings];
  // a source by its number (Fireberry's originatingleadcode): its name and project, once a manager named it
  let source = lead.source ?? key.source;
  let codeProject: string | null = null;
  if (lead.sourceCode) {
    const named = await sourceForCode(lead.sourceCode, key.name);
    if (named.source) {
      source = named.source;
      codeProject = named.projectId;
    } else {
      source = lead.source ?? placeholderSource(key.source, lead.sourceCode);
      warnings.push(`Source code ${lead.sourceCode} has no name in the CRM yet, so the lead was saved with the source "${source}". It takes the name once the code is named.`);
    }
  }
  const projectId = codeProject ?? (await resolveProject(lead.project, key.projectId, warnings));

  const input = {
    name: lead.name ?? NO_NAME,
    phone: lead.phone,
    email: lead.email,
    source,
    projectId,
    owner: "auto" as const,
    consent: lead.consent,
    campaign: lead.campaign,
    page: lead.page,
    payload: data,
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
}

const unavailable = () => fail(503, "Lead intake is not available yet: the CRM has no database connected.");
const broken = (err: unknown) => {
  console.error("[intake] could not take a lead", err);
  return fail(500, "Something went wrong on our side and the lead was not saved. Please try again in a moment.");
};

export async function POST(req: Request) {
  if (!hasDatabase()) return unavailable();
  try {
    const url = new URL(req.url);
    const auth = await authorize(req, url);
    if ("refused" in auth) return auth.refused;
    const query = fieldsFromQuery(url);
    const body = await readLeadBody(req);
    // fields may come in the address as well; the body wins. A post with an empty body and the fields in the address is fine too.
    if (!body.ok && !(body.empty && Object.keys(query).length)) {
      await prisma.apiKey.update({ where: { id: auth.key.id }, data: { lastUsedAt: new Date() } });
      return fail(body.status, body.error);
    }
    return await take(auth.key, { ...query, ...(body.ok ? body.data : {}) });
  } catch (err) {
    return broken(err);
  }
}

export async function GET(req: Request) {
  if (!hasDatabase()) return unavailable();
  try {
    const url = new URL(req.url);
    const auth = await authorize(req, url);
    if ("refused" in auth) return auth.refused;
    const query = fieldsFromQuery(url);
    if (!Object.keys(query).length)
      return reply(200, {
        ok: true,
        check: true,
        message: `This link works. Leads sent to it come in with the source "${auth.key.source}". Send each lead with POST (JSON or a form), or call this link with the lead's fields added, for example &name=...&phone=...`,
      });
    return await take(auth.key, query);
  } catch (err) {
    return broken(err);
  }
}

/** A link preview (WhatsApp, an email program) may only knock: nothing is saved. */
export function HEAD() {
  return new Response(null, { status: 204, headers: { "Cache-Control": "no-store" } });
}
