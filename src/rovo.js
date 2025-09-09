import api from "@forge/api";

export async function fetchRequirements(payload, context) {
  console.log("[rovo.fetchRequirements] payload:", payload);
  console.log("[rovo.fetchRequirements] context keys:", Object.keys(context || {}));
    try {
    const jiraKey = payload?.inputs?.jiraKey
      ?? payload?.jiraKey
      ?? payload?.context?.jira?.issueKey
      ?? payload?.context?.issueKey;
    console.log("[rovo.fetchRequirements] resolved jiraKey:", jiraKey);
    if (!jiraKey) {
      return { output: "jiraKey is required", data: [] };
    }

    const vitareq = api.asUser().withProvider("vitareq", "vitareq-api");
    const hasCreds = await vitareq.hasCredentials();
    console.log("[rovo.fetchRequirements] hasCredentials:", hasCreds);
    if (!hasCreds) {
      console.log("[rovo.fetchRequirements] no user creds available; attempting client-credentials fallback");
      const clientId = 'FGMiI81z8Sobv06TMZ4QsrSCUDTLO6gz';
      const clientSecret = process.env.CLIENT_SECRET;
      const tokenUrl = 'https://dev-yfve51b1ewip55b8.us.auth0.com/oauth/token';
      const audience = 'https://vitareq.api';
      if (!clientSecret) {
        console.warn('[rovo.fetchRequirements] CLIENT_SECRET missing; cannot use fallback. Returning auth required.');
        return { output: 'Authentication required. Please connect Vitareq or set CLIENT_SECRET for fallback.', data: [] };
      }
      try {
        const form = new URLSearchParams();
        form.set('grant_type', 'client_credentials');
        form.set('client_id', clientId);
        form.set('client_secret', clientSecret);
        form.set('audience', audience);
        const tokenResp = await api.fetch(tokenUrl, {
          method: 'POST',
          headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
          body: form.toString(),
        });
        if (!tokenResp.ok) {
          const t = await tokenResp.text();
          console.error('[rovo.fetchRequirements] fallback token error', tokenResp.status, t);
          return { output: `Auth failed (${tokenResp.status})`, data: [] };
        }
        const tokenJson = await tokenResp.json();
        const accessToken = tokenJson?.access_token;
        if (!accessToken) {
          console.error('[rovo.fetchRequirements] fallback token missing access_token');
          return { output: 'Auth failed (no access_token)', data: [] };
        }

        const url = `https://vitareq.vercel.app/api/requirements?jiraKey=${encodeURIComponent(jiraKey)}`;
        console.log('[rovo.fetchRequirements] (fallback) GET', url);
        const resp = await api.fetch(url, {
          headers: { Accept: 'application/json', Authorization: `Bearer ${accessToken}` },
        });
        console.log('[rovo.fetchRequirements] (fallback) status:', resp.status);
        const ct = resp.headers.get('content-type') || '';
        if (!resp.ok) {
          const raw = ct.includes('application/json') ? JSON.stringify(await resp.json()) : await resp.text();
          console.error('[rovo.fetchRequirements] (fallback) error', resp.status, raw);
          return { output: `Failed: ${resp.status}`, data: [] };
        }
        if (!ct.includes('application/json')) {
          const raw = await resp.text();
          console.log('[rovo.fetchRequirements] (fallback) raw:', raw?.slice?.(0, 500));
          return { output: 'Unexpected response', data: [] };
        }
        const data = await resp.json();
        const requirement = Array.isArray(data)
          ? data[0]
          : (Array.isArray(data?.requirements) ? data.requirements[0] : data);
        return {
          output: requirement?.requirementNumber ? `Found requirement ${requirement.requirementNumber}` : 'No requirement found',
          data: requirement ? [requirement] : [],
        };
      } catch (e) {
        console.error('[rovo.fetchRequirements] (fallback) exception', e?.message || e);
        return { output: 'Error', data: [] };
      }
    }

    const url = `/api/requirements?jiraKey=${encodeURIComponent(jiraKey)}`;
    console.log("[rovo.fetchRequirements] GET", url);
    const resp = await vitareq.fetch(url, {
      headers: { Accept: "application/json" },
    });

    console.log("[rovo.fetchRequirements] status:", resp.status);
    const ct = resp.headers.get("content-type") || "";
    console.log("[rovo.fetchRequirements] content-type:", ct);

    if (!resp.ok) {
      const errorBody = await resp.text();
      console.error("[rovo.fetchRequirements] error", resp.status, errorBody);
      return { output: `Failed: ${resp.status}`, data: [] };
    }

    const contentType = ct;
    if (!contentType.includes("application/json")) {
      const raw = await resp.text();
      console.log("[rovo.fetchRequirements] raw:", raw?.slice?.(0, 500));
      return { output: "Unexpected response", data: [] };
    }

    const data = await resp.json();
    console.log("[rovo.fetchRequirements] body keys:", Array.isArray(data) ? `array(${data.length})` : Object.keys(data || {}));
    const requirement = Array.isArray(data)
      ? data[0]
      : (Array.isArray(data?.requirements) ? data.requirements[0] : data);

    console.log("[rovo.fetchRequirements] resolved requirement:", requirement ? Object.keys(requirement) : requirement);
    return {
      output: requirement?.requirementNumber
        ? `Found requirement ${requirement.requirementNumber}`
        : "No requirement found",
      data: requirement ? [requirement] : [],
    };
  } catch (e) {
    console.error("[rovo.fetchRequirements] exception", e?.message || e, e?.stack);
    return { output: "Error", data: [] };
  }
}

export async function createRequirement(payload, context) {
  try {
    const title = payload?.inputs?.title;
    const description = payload?.inputs?.description;
    const status = payload?.inputs?.status;

    if (!title) {
      return { output: "title is required", data: [] };
    }

    const vitareq = api.asUser().withProvider("vitareq", "vitareq-api");
    if (!(await vitareq.hasCredentials())) {
      await vitareq.requestCredentials();
    }

    const body = {
      title,
      ...(description ? { description } : {}),
      ...(status ? { status } : {}),
    };

    const resp = await vitareq.fetch(`/api/requirements`, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      console.error("Rovo createRequirement error", resp.status, errorBody);
      return { output: `Failed: ${resp.status}`, data: [] };
    }

    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return { output: "Unexpected response", data: [] };
    }

    const created = await resp.json();
    const summary = created?.requirementNumber || created?.id || created?.title || "requirement";
    return { output: `Created ${summary}`, data: created ? [created] : [] };
  } catch (e) {
    console.error("Rovo createRequirement exception", e);
    return { output: "Error", data: [] };
  }
}

export async function updateRequirement(payload, context) {
  try {
    const id = payload?.inputs?.id;
    const title = payload?.inputs?.title;
    const description = payload?.inputs?.description;
    const status = payload?.inputs?.status;

    if (!id) {
      return { output: "id is required", data: [] };
    }

    const updates = {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(status ? { status } : {}),
    };

    if (Object.keys(updates).length === 0) {
      return { output: "No fields to update", data: [] };
    }

    const vitareq = api.asUser().withProvider("vitareq", "vitareq-api");
    if (!(await vitareq.hasCredentials())) {
      await vitareq.requestCredentials();
    }

    const resp = await vitareq.fetch(`/api/requirements/${encodeURIComponent(id)}`, {
      method: "PUT",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify(updates),
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      console.error("Rovo updateRequirement error", resp.status, errorBody);
      return { output: `Failed: ${resp.status}`, data: [] };
    }

    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return { output: "Unexpected response", data: [] };
    }

    const updated = await resp.json();
    const summary = updated?.requirementNumber || updated?.id || updated?.title || id;
    return { output: `Updated ${summary}`, data: updated ? [updated] : [] };
  } catch (e) {
    console.error("Rovo updateRequirement exception", e);
    return { output: "Error", data: [] };
  }
}

