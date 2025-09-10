import api from "@forge/api";
import { kvs } from '@forge/kvs';

const VITAREQ_BASE = 'https://vitareq.vercel.app';
const AUTH0_TOKEN_URL = 'https://dev-yfve51b1ewip55b8.us.auth0.com/oauth/token';
const AUTH0_AUDIENCE = 'https://vitareq.api';
// client id is stored in kvs as 'vitareq:active:clientId'

async function getClientCredentialsAccessToken() {
  const clientId = await kvs.getSecret('vitareq:active:clientId');
  const clientSecret = await kvs.getSecret('vitareq:active:clientSecret');
  if (!clientId || !clientSecret) {
    console.warn('[rovo] client credentials missing in KVS; cannot use client-credentials fallback');
    return undefined;
  }
  const form = new URLSearchParams();
  form.set('grant_type', 'client_credentials');
  form.set('client_id', clientId);
  form.set('client_secret', clientSecret);
  form.set('audience', AUTH0_AUDIENCE);
  const tokenResp = await api.fetch(AUTH0_TOKEN_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
    body: form.toString(),
  });
  if (!tokenResp.ok) {
    const t = await tokenResp.text();
    console.error('[rovo] client-credentials token error', tokenResp.status, t);
    return undefined;
  }
  const tokenJson = await tokenResp.json();
  const accessToken = tokenJson?.access_token;
  if (!accessToken) {
    console.error('[rovo] client-credentials token missing access_token');
    return undefined;
  }
  return accessToken;
}

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
      const clientId = await kvs.getSecret('vitareq:active:clientId');
      const clientSecret = await kvs.getSecret('vitareq:active:clientSecret');
      const tokenUrl = 'https://dev-yfve51b1ewip55b8.us.auth0.com/oauth/token';
      const audience = 'https://vitareq.api';
      if (!clientId || !clientSecret) {
        console.warn('[rovo.fetchRequirements] client credentials missing in KVS; cannot use fallback. Returning auth required.');
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
    let resp;
    if (hasCreds) {
      resp = await vitareq.fetch(url, { headers: { Accept: "application/json" } });
    } else {
      const token = await getClientCredentialsAccessToken();
      if (!token) return { output: 'Authentication required', data: [] };
      resp = await api.fetch(`${VITAREQ_BASE}${url}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
    }

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
    const hasCreds = await vitareq.hasCredentials();
    console.log('[rovo.createRequirement] hasCredentials:', hasCreds);

    const body = {
      title,
      ...(description ? { description } : {}),
      ...(status ? { status } : {}),
    };

    let resp;
    if (hasCreds) {
      resp = await vitareq.fetch(`/api/requirements`, {
        method: "POST",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
    } else {
      console.log('[rovo.createRequirement] using client-credentials fallback');
      const token = await getClientCredentialsAccessToken();
      if (!token) return { output: 'Authentication required', data: [] };
      resp = await api.fetch(`${VITAREQ_BASE}/api/requirements`, {
        method: 'POST',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(body),
      });
    }

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
  console.log("[rovo.updateRequirement] payload:", payload);
  console.log("[rovo.updateRequirement] context keys:", Object.keys(context || {}));
  try {
    const requirementNumber = payload?.inputs?.requirementNumber
      ?? payload?.requirementNumber
      ?? payload?.inputs?.id
      ?? payload?.id;
    const title = payload?.inputs?.title ?? payload?.title;
    const description = payload?.inputs?.description ?? payload?.description;
    const status = payload?.inputs?.status ?? payload?.status;
    console.log("[rovo.updateRequirement] inputs:", { requirementNumber, title, hasDescription: !!description, status });

    if (!requirementNumber) {
      return { output: "requirementNumber is required", data: [] };
    }

    const updates = {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(status ? { status } : {}),
    };

    if (Object.keys(updates).length === 0) {
      console.log("[rovo.updateRequirement] no updates provided");
      return { output: "No fields to update", data: [] };
    }

    const vitareq = api.asUser().withProvider("vitareq", "vitareq-api");
    const hasCreds = await vitareq.hasCredentials();
    console.log("[rovo.updateRequirement] hasCredentials:", hasCreds);

    const url = `/api/requirements/${encodeURIComponent(requirementNumber)}`;
    console.log("[rovo.updateRequirement] PUT", url, "body:", updates);
    let resp;
    if (hasCreds) {
      resp = await vitareq.fetch(url, {
        method: "PUT",
        headers: { Accept: "application/json", "Content-Type": "application/json" },
        body: JSON.stringify(updates),
      });
    } else {
      console.log('[rovo.updateRequirement] using client-credentials fallback');
      const token = await getClientCredentialsAccessToken();
      if (!token) return { output: 'Authentication required', data: [] };
      resp = await api.fetch(`${VITAREQ_BASE}${url}`, {
        method: 'PUT',
        headers: { Accept: 'application/json', 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
        body: JSON.stringify(updates),
      });
    }

    console.log("[rovo.updateRequirement] status:", resp.status);
    const ct = resp.headers.get("content-type") || "";
    console.log("[rovo.updateRequirement] content-type:", ct);
    if (!resp.ok) {
      const errorBody = ct.includes("application/json") ? JSON.stringify(await resp.json()) : await resp.text();
      console.error("[rovo.updateRequirement] error", resp.status, errorBody);
      return { output: `Failed: ${resp.status}`, data: [] };
    }

    const contentType = ct;
    if (!contentType.includes("application/json")) {
      const raw = await resp.text();
      console.log("[rovo.updateRequirement] raw:", raw?.slice?.(0, 500));
      return { output: "Unexpected response", data: [] };
    }

    const updated = await resp.json();
    console.log("[rovo.updateRequirement] updated keys:", Object.keys(updated || {}));
    const summary = updated?.requirementNumber || updated?.id || updated?.title || requirementNumber;
    return { output: `Updated ${summary}`, data: updated ? [updated] : [] };
  } catch (e) {
    console.error("[rovo.updateRequirement] exception", e?.message || e, e?.stack);
    return { output: "Error", data: [] };
  }
}

export async function fetchAllRequirements(payload, context) {
  console.log('[rovo.fetchAllRequirements] start');
  try {
    const vitareq = api.asUser().withProvider('vitareq', 'vitareq-api');
    const hasCreds = await vitareq.hasCredentials();
    console.log('[rovo.fetchAllRequirements] hasCredentials:', hasCreds);

    let resp;
    const path = `/api/requirements`;
    if (hasCreds) {
      resp = await vitareq.fetch(path, { headers: { Accept: 'application/json' } });
    } else {
      console.log('[rovo.fetchAllRequirements] using client-credentials fallback');
      const token = await getClientCredentialsAccessToken();
      if (!token) return { output: 'Authentication required', data: [] };
      resp = await api.fetch(`${VITAREQ_BASE}${path}`, { headers: { Accept: 'application/json', Authorization: `Bearer ${token}` } });
    }

    console.log('[rovo.fetchAllRequirements] status:', resp.status);
    const ct = resp.headers.get('content-type') || '';
    if (!resp.ok) {
      const raw = ct.includes('application/json') ? JSON.stringify(await resp.json()) : await resp.text();
      console.error('[rovo.fetchAllRequirements] error', resp.status, raw);
      return { output: `Failed: ${resp.status}`, data: [] };
    }
    if (!ct.includes('application/json')) {
      const raw = await resp.text();
      console.log('[rovo.fetchAllRequirements] raw:', raw?.slice?.(0, 500));
      return { output: 'Unexpected response', data: [] };
    }
    const data = await resp.json();
    const list = Array.isArray(data) ? data : (Array.isArray(data?.requirements) ? data.requirements : []);
    console.log('[rovo.fetchAllRequirements] count:', list.length);
    return {
      output: `Found ${list.length} requirements`,
      data: list,
    };
  } catch (e) {
    console.error('[rovo.fetchAllRequirements] exception', e?.message || e, e?.stack);
    return { output: 'Error', data: [] };
  }
}

