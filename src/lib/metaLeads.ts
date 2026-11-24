// Leads from Facebook and Instagram Lead Ads into the system: one lead from the webhook, the leads of a page's forms
// pulled since a moment (to bring in what came before connecting, and as a safety net every few minutes), and the
// form → project choice. Each lead is taken once: its Facebook id is kept on the inquiry.
import { createOrMergeLead } from "./crm/service";
import { prisma } from "./db";
import { mapLeadFields, NO_NAME } from "./intake";
import { fetchLead, formLeads, graph, leadFields, MetaError, metaConfig, openToken, pageForms, type MetaConfig, type MetaLead } from "./meta";
import { Recorder } from "./undo";

type PageRow = { id: string; name: string; token: string; supplier?: string | null; source?: string | null; projectId?: string | null };
export type Taken = "created" | "merged" | "seen" | "skipped";

const externalId = (leadgenId: string) => `meta:${leadgenId}`;
const isUnique = (e: unknown) => typeof e === "object" && e !== null && (e as { code?: unknown }).code === "P2002";

async function ensureForm(cfg: MetaConfig, page: PageRow, formId: string, token: string, knownName?: string) {
  const found = await prisma.metaForm.findUnique({ where: { id: formId } });
  if (found) {
    if (knownName && knownName !== found.name) return prisma.metaForm.update({ where: { id: formId }, data: { name: knownName } });
    return found;
  }
  let name = knownName ?? "";
  if (!name) name = (await graph<{ name?: string }>(cfg, formId, token, { fields: "name" }).catch(() => ({ name: "" }))).name ?? "";
  return prisma.metaForm.upsert({ where: { id: formId }, create: { id: formId, pageId: page.id, name: name || `טופס ${formId}` }, update: {} });
}

/** A project by the form's choice, else the supplier's project, else a "project" answer in the form; null when none is known. */
async function projectFor(chosen: (string | null | undefined)[], answered: string | null): Promise<string | null> {
  for (const id of chosen) if (id && (await prisma.project.count({ where: { id } }))) return id;
  if (!answered) return null;
  const p = await prisma.project.findFirst({
    where: { OR: [{ name: { equals: answered, mode: "insensitive" } }, { fullName: { equals: answered, mode: "insensitive" } }] },
    orderBy: [{ active: "desc" }, { sortOrder: "asc" }],
    select: { id: true },
  });
  return p?.id ?? null;
}

/** Takes one lead into the system. `hint` is the lead when it was already read (pulling a form's leads). */
export async function takeMetaLead(cfg: MetaConfig, page: PageRow, leadgenId: string, hint?: MetaLead): Promise<Taken> {
  if (await prisma.inquiry.count({ where: { externalId: externalId(leadgenId) } })) return "seen";
  const token = openToken(page.token);
  const lead = hint ?? (await fetchLead(cfg, leadgenId, token));
  const form = lead.form_id ? await ensureForm(cfg, page, lead.form_id, token) : null;
  const answers = leadFields(lead);
  const mapped = mapLeadFields(answers);
  if (!mapped.ok) {
    await prisma.metaPage.update({ where: { id: page.id }, data: { lastError: `ליד בלי טלפון תקין בטופס ״${form?.name ?? ""}״ לא נקלט` } });
    return "skipped";
  }
  const l = mapped.lead;
  const input = {
    name: l.name ?? NO_NAME,
    phone: l.phone,
    email: l.email,
    // a supplier's page comes in with the supplier's source; our own pages say Facebook or Instagram
    source: page.source || (lead.platform === "ig" ? "אינסטגרם" : "פייסבוק"),
    projectId: await projectFor([form?.projectId, page.projectId], l.project),
    owner: "auto" as const,
    consent: l.consent,
    campaign: lead.campaign_name ?? l.campaign ?? null,
    page: form?.name ?? null,
    externalId: externalId(leadgenId),
    payload: {
      meta: {
        leadgen_id: leadgenId,
        page: page.name,
        supplier: page.supplier ?? null,
        form: form?.name ?? null,
        form_id: lead.form_id ?? null,
        ad: lead.ad_name ?? null,
        ad_id: lead.ad_id ?? null,
        adset: lead.adset_name ?? null,
        campaign: lead.campaign_name ?? null,
        platform: lead.platform ?? null,
        organic: lead.is_organic ?? null,
        created_time: lead.created_time ?? null,
      },
      answers,
    },
  };
  let result: Awaited<ReturnType<typeof createOrMergeLead>>;
  try {
    result = await prisma.$transaction((tx) => createOrMergeLead(tx, new Recorder(tx), input, null));
  } catch (e) {
    // the webhook and the safety net brought the same lead at the same moment
    if (isUnique(e)) return "seen";
    throw e;
  }
  const now = new Date();
  if (form) await prisma.metaForm.update({ where: { id: form.id }, data: { leads: { increment: 1 }, lastLeadAt: now } });
  await prisma.metaPage.update({ where: { id: page.id }, data: { lastLeadAt: now, lastError: null } });
  return result.duplicate ? "merged" : "created";
}

/** Every form of a page (their names, for choosing projects), and the leads that came in since a moment. */
export async function pullPage(cfg: MetaConfig, page: PageRow, since: Date): Promise<{ created: number; merged: number; forms: number }> {
  const token = openToken(page.token);
  const started = new Date();
  const forms = await pageForms(cfg, page.id, token);
  let created = 0;
  let merged = 0;
  for (const f of forms) {
    await ensureForm(cfg, page, f.id, token, f.name);
    const leads = await formLeads(cfg, f.id, token, since);
    // oldest first, so the history reads in order
    leads.sort((a, b) => (a.created_time ?? "").localeCompare(b.created_time ?? ""));
    for (const lead of leads) {
      const r = await takeMetaLead(cfg, page, lead.id, { ...lead, form_id: lead.form_id ?? f.id });
      if (r === "created") created++;
      else if (r === "merged") merged++;
    }
  }
  await prisma.metaPage.update({ where: { id: page.id }, data: { lastPullAt: started } });
  return { created, merged, forms: forms.length };
}

/** Pulls every connected page; a page that fails keeps its error for the intake screen, and the others go on. */
export async function pullAll(sinceFor: (lastPullAt: Date | null) => Date): Promise<{ created: number; merged: number; failed: number }> {
  const cfg = metaConfig();
  const out = { created: 0, merged: 0, failed: 0 };
  if (!cfg) return out;
  const pages = await prisma.metaPage.findMany({ where: { active: true } });
  for (const p of pages) {
    try {
      const r = await pullPage(cfg, p, sinceFor(p.lastPullAt));
      out.created += r.created;
      out.merged += r.merged;
    } catch (e) {
      out.failed++;
      const msg = e instanceof MetaError ? e.message : "החיבור לפייסבוק לא הצליח";
      await prisma.metaPage.update({ where: { id: p.id }, data: { lastError: msg.slice(0, 300) } }).catch(() => {});
      console.error("[meta] pulling leads failed for page", p.id, e);
    }
  }
  return out;
}

/** Every ten minutes: what the webhook may have missed in the last hours. */
export function startMetaPull() {
  const g = globalThis as { __meitarMetaPull?: ReturnType<typeof setInterval> };
  if (g.__meitarMetaPull || !metaConfig()) return;
  g.__meitarMetaPull = setInterval(
    () => {
      pullAll((last) => new Date(Math.max(Date.now() - 7 * 86_400_000, (last?.getTime() ?? Date.now() - 86_400_000) - 60 * 60_000))).catch((e) => console.error("[meta] pull failed", e));
    },
    10 * 60_000,
  );
}
