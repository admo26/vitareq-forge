import api, { route } from "@forge/api";
import { kvs } from '@forge/kvs';

const VITAREQ_BASE = 'https://vitareq.vercel.app';
const AUTH0_TOKEN_URL = 'https://dev-yfve51b1ewip55b8.us.auth0.com/oauth/token';
const AUTH0_AUDIENCE = 'https://vitareq.api';
// client id is stored in kvs as 'vitareq:active:clientId'

function resolveJiraKeyFromInputs(payload, context) {
  return payload?.inputs?.jiraKey
    ?? payload?.jiraKey
    ?? payload?.context?.jira?.issueKey
    ?? payload?.context?.issueKey
    ?? context?.jira?.issueKey
    ?? context?.issueKey;
}

function parseRequirementFromData(data) {
  if (!data) return undefined;
  if (Array.isArray(data)) return data[0];
  if (Array.isArray(data?.requirements)) return data.requirements[0];
  return data;
}

function parseRequirementListFromData(data) {
  if (Array.isArray(data)) return data;
  if (Array.isArray(data?.requirements)) return data.requirements;
  return [];
}

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

async function fetchVitareq(path, init = {}) {
  const vitareq = api.asUser().withProvider('vitareq', 'vitareq-api');
  const hasCreds = await vitareq.hasCredentials();
  const headers = init.headers || {};
  if (hasCreds) {
    return vitareq.fetch(path, { ...init, headers: { Accept: 'application/json', ...headers } });
  }
  const token = await getClientCredentialsAccessToken();
  if (!token) return undefined;
  return api.fetch(`${VITAREQ_BASE}${path}`, {
    ...init,
    headers: { Accept: 'application/json', Authorization: `Bearer ${token}`, ...headers },
  });
}

async function getJiraBrowseUrl(issueKey) {
  if (!issueKey) return undefined;
  try {
    const resp = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}`);
    const ct = resp.headers.get('content-type') || '';
    if (!resp.ok) return undefined;
    const issue = ct.includes('application/json') ? await resp.json() : undefined;
    const selfUrl = issue?.self;
    if (!selfUrl) return undefined;
    try {
      const u = new URL(selfUrl);
      return `${u.protocol}//${u.host}/browse/${issue?.key || issueKey}`;
    } catch (_) {
      return undefined;
    }
  } catch (_) {
    return undefined;
  }
}

export async function fetchRequirements(payload, context) {
  try {
    const jiraKey = resolveJiraKeyFromInputs(payload, context);
    if (!jiraKey) {
      return { output: "jiraKey is required", data: [] };
    }

    const path = `/api/requirements?jiraKey=${encodeURIComponent(jiraKey)}`;
    const resp = await fetchVitareq(path);
    if (!resp) return { output: 'Authentication required', data: [] };

    const ct = resp.headers.get("content-type") || "";
    if (!resp.ok) {
      const errorBody = await resp.text();
      console.error("[rovo.fetchRequirements] error", resp.status, errorBody);
      return { output: `Failed: ${resp.status}`, data: [] };
    }
    if (!ct.includes("application/json")) {
      await resp.text();
      return { output: "Unexpected response", data: [] };
    }

    const data = await resp.json();
    const requirement = parseRequirementFromData(data);
    if (requirement && requirement.jiraKey && !requirement.jiraIssueUrl) {
      const url = await getJiraBrowseUrl(requirement.jiraKey);
      if (url) requirement.jiraIssueUrl = url;
    }
    return {
      output: requirement?.requirementNumber ? `Found requirement ${requirement.requirementNumber}` : "No requirement found",
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

    const body = {
      title,
      ...(description ? { description } : {}),
      ...(status ? { status } : {}),
    };

    const resp = await fetchVitareq(`/api/requirements`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!resp) return { output: 'Authentication required', data: [] };

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
    const requirementNumber = payload?.inputs?.requirementNumber
      ?? payload?.requirementNumber
      ?? payload?.inputs?.id
      ?? payload?.id;
    const title = payload?.inputs?.title ?? payload?.title;
    const description = payload?.inputs?.description ?? payload?.description;
    const status = payload?.inputs?.status ?? payload?.status;

    if (!requirementNumber) {
      return { output: "requirementNumber is required", data: [] };
    }

    const updates = {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(status ? { status } : {}),
    };

    if (Object.keys(updates).length === 0) {
      return { output: "No fields to update", data: [] };
    }

    const url = `/api/requirements/${encodeURIComponent(requirementNumber)}`;
    const resp = await fetchVitareq(url, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(updates),
    });
    if (!resp) return { output: 'Authentication required', data: [] };
    const ct = resp.headers.get("content-type") || "";
    if (!resp.ok) {
      const errorBody = ct.includes("application/json") ? JSON.stringify(await resp.json()) : await resp.text();
      console.error("[rovo.updateRequirement] error", resp.status, errorBody);
      return { output: `Failed: ${resp.status}`, data: [] };
    }

    const contentType = ct;
    if (!contentType.includes("application/json")) {
      await resp.text();
      return { output: "Unexpected response", data: [] };
    }

    const updated = await resp.json();
    const summary = updated?.requirementNumber || updated?.id || updated?.title || requirementNumber;
    return { output: `Updated ${summary}`, data: updated ? [updated] : [] };
  } catch (e) {
    console.error("[rovo.updateRequirement] exception", e?.message || e, e?.stack);
    return { output: "Error", data: [] };
  }
}

export async function fetchAllRequirements(payload, context) {
  try {
    const path = `/api/requirements`;
    const resp = await fetchVitareq(path);
    if (!resp) return { output: 'Authentication required', data: [] };
    const ct = resp.headers.get('content-type') || '';
    if (!resp.ok) {
      const raw = ct.includes('application/json') ? JSON.stringify(await resp.json()) : await resp.text();
      console.error('[rovo.fetchAllRequirements] error', resp.status, raw);
      return { output: `Failed: ${resp.status}`, data: [] };
    }
    if (!ct.includes('application/json')) {
      await resp.text();
      return { output: 'Unexpected response', data: [] };
    }
    const data = await resp.json();
    const list = parseRequirementListFromData(data);
    for (const r of list) {
      if (r && r.jiraKey && !r.jiraIssueUrl) {
        const url = await getJiraBrowseUrl(r.jiraKey);
        if (url) r.jiraIssueUrl = url;
      }
    }
    return {
      output: `Found ${list.length} requirements`,
      data: list,
    };
  } catch (e) {
    console.error('[rovo.fetchAllRequirements] exception', e?.message || e, e?.stack);
    return { output: 'Error', data: [] };
  }
}

export async function commentOnJiraIssue(payload, context) {
  try {
    const issueKey = payload?.inputs?.issueKey
      ?? payload?.issueKey
      ?? resolveJiraKeyFromInputs(payload, context);
    const comment = payload?.inputs?.comment
      ?? payload?.comment
      ?? payload?.inputs?.body;
    if (!issueKey) {
      return { output: 'issueKey is required', data: [] };
    }
    if (!comment || !String(comment).trim()) {
      return { output: 'comment is required', data: [] };
    }

    const document = {
      type: 'doc',
      version: 1,
      content: [
        { type: 'paragraph', content: [{ type: 'text', text: String(comment) }] },
      ],
    };

    const resp = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}/comment`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ body: document }),
    });
    const ct = resp.headers.get('content-type') || '';
    if (!resp.ok) {
      const raw = ct.includes('application/json') ? JSON.stringify(await resp.json()) : await resp.text();
      console.error('[rovo.commentOnJiraIssue] error', resp.status, raw);
      return { output: `Failed: ${resp.status}`, data: [] };
    }
    const created = ct.includes('application/json') ? await resp.json() : undefined;

    return { output: `Comment added to ${issueKey}`, data: created ? [created] : [] };
  } catch (e) {
    console.error('[rovo.commentOnJiraIssue] exception', e?.message || e, e?.stack);
    return { output: 'Error', data: [] };
  }
}


export async function fetchJiraIssue(payload, context) {
  try {
    const issueKey = payload?.inputs?.issueKey
      ?? payload?.issueKey
      ?? resolveJiraKeyFromInputs(payload, context);
    if (!issueKey) {
      return { output: 'issueKey is required', data: [] };
    }

    const resp = await api.asUser().requestJira(route`/rest/api/3/issue/${issueKey}`);
    const ct = resp.headers.get('content-type') || '';
    if (!resp.ok) {
      const raw = ct.includes('application/json') ? JSON.stringify(await resp.json()) : await resp.text();
      console.error('[rovo.fetchJiraIssue] error', resp.status, raw);
      return { output: `Failed: ${resp.status}`, data: [] };
    }
    if (!ct.includes('application/json')) {
      await resp.text();
      return { output: 'Unexpected response', data: [] };
    }

    const issue = await resp.json();
    const selfUrl = issue?.self || '';
    let base = '';
    try {
      if (selfUrl) {
        const u = new URL(selfUrl);
        base = `${u.protocol}//${u.host}`;
      }
    } catch (_) {
      // ignore
    }
    const webUrl = base && (issue?.key || issueKey) ? `${base}/browse/${issue?.key || issueKey}` : undefined;

    const summary = issue?.fields?.summary || issue?.key || issueKey;
    const statusName = issue?.fields?.status?.name;
    const assignee = issue?.fields?.assignee?.displayName;
    const reporter = issue?.fields?.reporter?.displayName;

    const data = {
      id: issue?.id,
      key: issue?.key || issueKey,
      summary,
      status: statusName,
      assignee,
      reporter,
      url: webUrl,
      self: selfUrl,
    };

    return { output: `Found issue ${issue?.key || issueKey}${summary ? `: ${summary}` : ''}`.trim(), data: [data] };
  } catch (e) {
    console.error('[rovo.fetchJiraIssue] exception', e?.message || e, e?.stack);
    return { output: 'Error', data: [] };
  }
}

