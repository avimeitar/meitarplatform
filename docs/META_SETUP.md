# Facebook & Instagram Lead Ads: connecting the CRM directly to Meta

The CRM receives leads straight from Lead Ads forms, with no Make or Zapier:
- **Meitar's own pages:** a system administrator connects them once from the CRM.
- **Lead suppliers with their own pages and ad accounts:** the CRM creates a personal link per supplier. The supplier opens it, signs in with Facebook and picks their page. From then on their leads arrive by themselves, with the supplier's source and project.

On Meta's side this needs a **Meta developer app**. The prompt below is written for a Claude agent working in the browser (Claude in Chrome), with the person sitting next to it.

---

## Prompt for the browser agent (copy everything below)

You are setting up a Meta developer app so that Meitar Group's CRM (https://crm.meitargroup.co.il) receives leads from Facebook and Instagram Lead Ads directly. Work in the open browser tabs; I am signed in to Facebook (as an admin of Meitar's page and Business portfolio), to Railway, and to the CRM as a system administrator.

**Rules**
- Never write the App Secret, passwords or codes in the chat or in any note. Copy the App Secret from Meta straight into Railway's variable field, and nothing else.
- When Meta asks for my password, a 2-factor code, identity or business documents, stop and ask me to do that step.
- Don't change anything else in Meta, Railway or the CRM beyond these steps. If a screen looks different from what's described, choose the closest option and tell me what you chose.
- At the end, report what you did in each step, and anything that failed with its exact error text.

**Values you will need.** They are all on the CRM screen https://crm.meitargroup.co.il/intake, in the section "פייסבוק ואינסטגרם", under "הערכים שמוגדרים באפליקציה של Meta" (each has a copy button):
- Webhook Callback URL: `https://crm.meitargroup.co.il/api/meta/webhook`
- Webhook Verify token: copy it from that screen (a 32-character code)
- Valid OAuth Redirect URI: `https://crm.meitargroup.co.il/api/meta/callback`
- App domain: `crm.meitargroup.co.il`
- Privacy Policy URL: `https://crm.meitargroup.co.il/privacy`
- User data deletion (instructions URL): `https://crm.meitargroup.co.il/data-deletion`

**Step 1: create the app**
1. Go to https://developers.facebook.com/apps and click "Create app".
2. App name: `Meitar CRM`. Contact email: mine.
3. Use case: "Capture & manage ad leads with Marketing API". If it isn't offered, choose "Other", then app type "Business".
4. Business portfolio: Meitar's.
5. Create the app.

**Step 2: basic settings** (App settings → Basic)
1. App domains: `crm.meitargroup.co.il`.
2. Privacy Policy URL and User data deletion (Data deletion instructions URL): the values above.
3. Category: Business and Pages.
4. Save changes.

**Step 3: Facebook Login for Business**
1. Add the product "Facebook Login for Business". If the app only offers "Facebook Login", use that one.
2. In its Settings:
   - Valid OAuth Redirect URIs: the Redirect URI above.
   - Client OAuth login, Web OAuth login and Enforce HTTPS: on.
3. Save.
4. Facebook Login for Business only: under "Configurations", create a configuration:
   - Name: `Meitar CRM leads`
   - Access token: "User access token"
   - Assets: Pages
   - Permissions: `pages_show_list`, `pages_read_engagement`, `pages_manage_metadata`, `pages_manage_ads`, `leads_retrieval`
5. Create it and note its **Configuration ID**. It isn't secret; I'll need it in step 5.

**Step 4: the webhook**
1. Open Webhooks in the app (under the use case's settings, or Products → Webhooks).
2. Object: **Page** → "Subscribe to this object".
3. Callback URL and Verify token: the values above. Click "Verify and save". It must succeed: the CRM answers Meta's check.
4. In the Page fields, find **leadgen** and click Subscribe.

**Step 5: Railway variables**
1. Go to https://railway.com, open Meitar's project, then the web service (not Postgres), then Variables.
2. Add these variables:
   - `META_APP_ID`: the App ID (App settings → Basic).
   - `META_APP_SECRET`: the App Secret (App settings → Basic → Show). Meta may ask for my password; ask me to type it. Copy the value straight into the variable, and don't show or repeat it.
   - `META_LOGIN_CONFIG_ID`: the Configuration ID from step 3. Skip this one if there was no Login for Business configuration.
3. Check that `BETTER_AUTH_URL` is `https://crm.meitargroup.co.il`. If it isn't, tell me before changing it.
4. Apply the changes (Deploy) and wait until the deployment finishes.

**Step 6: publish the app**
1. In the app dashboard, switch it from Development to **Live** (Publish).
2. If Meta asks for anything first (privacy URL, category, icon, business verification), tell me what it asks for.

**Step 7: leads access in the Business portfolio**
1. Go to https://business.facebook.com/settings, then Integrations, then **Leads access**.
2. Choose Meitar's page. Under "CRMs", assign the app `Meitar CRM`.
3. If leads access is limited to specific people, make sure I am on the list.

**Step 8: connect the page in the CRM**
1. Go to https://crm.meitargroup.co.il/intake. In the section "פייסבוק ואינסטגרם", click "חיבור לפייסבוק".
2. In Facebook's window, choose Meitar's page(s) and allow everything asked.
3. Back in the CRM, a green message should say the connection succeeded, and the page should be listed.
4. If the page shows a red message, copy its text into your report.

**Step 9: test**
1. Open https://developers.facebook.com/tools/lead-ads-testing.
2. Choose Meitar's page and a form, and click "Create lead". If there is an old test lead, delete it first.
3. Within a minute the test lead should appear in the CRM's clients list (https://crm.meitargroup.co.il/leads) with source פייסבוק.
4. In the CRM, under the page, each form is listed. Tell me the form names, so I can choose each form's project.
5. Click "משיכת לידים מ-90 הימים האחרונים" to bring in leads that came in before the connection.

**Step 10: only if real leads don't arrive, or for lead suppliers' pages**
Pages of lead suppliers (people who are not users of our app), and in some accounts real leads from our own page too, need **Advanced Access** from Meta's review.
1. App Review → Permissions and features: request Advanced Access for `leads_retrieval`, `pages_manage_ads`, `pages_manage_metadata`, `pages_read_engagement`, `pages_show_list`.
2. Use-case description: "Meitar Group's CRM receives leads from Facebook and Instagram Lead Ads forms on pages that Meitar Group or its lead suppliers manage. A page admin connects the page once with Facebook Login; new leads arrive through the leadgen webhook and are read with leads_retrieval, only to contact the people who asked about Meitar's real-estate projects."
3. Meta asks for a screen recording. It should show:
   - signing in to the CRM,
   - "חיבור לפייסבוק",
   - choosing a page,
   - a test lead arriving in the clients list.
   Ask me to record it, or record it if you can.
4. Business verification (https://business.facebook.com → Security center): ask me for the company documents.
5. Submit, and tell me the status.

---

## After the setup

- **Choose a project per form:** קליטת לידים → פייסבוק ואינסטגרם → the "לאיזה פרויקט" select next to each form.
- **A lead supplier:** "קישור חיבור לספק" → supplier name, source, project → send the link by WhatsApp or email. The link is valid for 30 days and can be cancelled.
- **Safety net:** every 10 minutes the CRM also checks each connected page for leads the webhook missed. A lead is never taken twice.
- **Disconnecting a page:** "ניתוק" next to the page.
