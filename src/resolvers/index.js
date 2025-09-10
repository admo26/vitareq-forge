import Resolver from '@forge/resolver';
import api from "@forge/api";
import { graph } from '@forge/teamwork-graph';
import { kvs } from '@forge/kvs';

const resolver = new Resolver();

function extractFirstRequirementNumber(payload) {
  if (!payload) {
    return undefined;
  }

  // Handle single object with a top-level requirementNumber
  if (payload && typeof payload === 'object' && 'requirementNumber' in payload) {
    return payload.requirementNumber;
  }

  const tryExtract = (item) => {
    if (item && typeof item === 'object' && 'requirementNumber' in item) {
      return item.requirementNumber;
    }
    return undefined;
  };

  if (Array.isArray(payload)) {
    return tryExtract(payload[0]);
  }

  if (Array.isArray(payload?.requirements)) {
    return tryExtract(payload.requirements[0]);
  }

  if (Array.isArray(payload?.items)) {
    return tryExtract(payload.items[0]);
  }

  if (Array.isArray(payload?.data)) {
    return tryExtract(payload.data[0]);
  }

  // Fallback: shallow search for first object with requirementNumber
  for (const value of Object.values(payload)) {
    if (Array.isArray(value)) {
      const candidate = tryExtract(value[0]);
      if (candidate !== undefined) return candidate;
    } else if (value && typeof value === 'object') {
      const candidate = tryExtract(value);
      if (candidate !== undefined) return candidate;
    }
  }

  return undefined;
}

resolver.define('getText', async (req) => {
  const vitareq = api.asUser().withProvider('vitareq', 'vitareq-api')

  if (!(await vitareq.hasCredentials())) {
    await vitareq.requestCredentials()
  }

  const issueKey = req?.context?.extension?.issue?.key
    ?? req?.context?.extension?.issueKey
    ?? req?.context?.issue?.key;

  if (!issueKey) {
    console.error('Issue key not available in context');
    return { error: 'Issue key unavailable' };
  }

  const url = `/api/requirements?jiraKey=${encodeURIComponent(issueKey)}`;

  const response = await vitareq.fetch(url, {
    headers: { Accept: 'application/json' },
  });

  const contentType = response.headers.get('content-type') || '';

  if (!response.ok) {
    if (response.status === 404) {
      return { error: 'No requirement found' };
    }
    const errorBody = await response.text();
    console.error('Vitareq API error', response.status, errorBody, 'IssueKey:', issueKey);
    return { error: `Error fetching requirements (${response.status})` };
  }

  if (contentType.includes('application/json')) {
    const data = await response.json();
    // Determine the requirement object from common response shapes
    let requirement = null;
    if (Array.isArray(data)) {
      requirement = data[0] ?? null;
    } else if (Array.isArray(data?.requirements)) {
      requirement = data.requirements[0] ?? null;
    } else if (data && typeof data === 'object') {
      requirement = data;
    }

    if (requirement) {
      console.log('Requirement payload resolved:', requirement);
      return requirement;
    }

    console.log('No requirement object found in response');
    return { error: 'No requirement found' };
  }

  const text = await response.text();
  console.log('Non-JSON response received');
  return { error: 'Unexpected non-JSON response', raw: text };
})

resolver.define('importRequirements', async () => {
  try {
    console.log('[importRequirements] start');
    const now = new Date();
    const nowIso = now.toISOString();
    const baseUpdateSeq = Date.now();
    console.log('[importRequirements] timestamps', { nowIso, baseUpdateSeq });

    // Fetch full requirements from Vitareq via client credentials
    const clientId = await kvs.getSecret('vitareq:active:clientId');
    const clientSecret = await kvs.getSecret('vitareq:active:clientSecret');
    const tokenUrl = 'https://dev-yfve51b1ewip55b8.us.auth0.com/oauth/token';
    const audience = 'https://vitareq.api';

    if (!clientId || !clientSecret) {
      console.error('[importRequirements] Missing client credentials in KVS');
      return { success: false, error: 'Missing client credentials' };
    }

    console.log('[importRequirements] Requesting client credentials token');
    const tokenResp = await api.fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        audience,
        grant_type: 'client_credentials',
      }),
    });

    if (!tokenResp.ok) {
      const txt = await tokenResp.text();
      console.error('[importRequirements] Token error', tokenResp.status, txt);
      return { success: false, error: `Token request failed (${tokenResp.status})` };
    }

    const tokenJson = await tokenResp.json();
    const accessToken = tokenJson?.access_token;
    if (!accessToken) {
      console.error('[importRequirements] No access_token in response', tokenJson);
      return { success: false, error: 'No access_token in token response' };
    }

    console.log('[importRequirements] Token acquired, fetching requirements');
    const reqResp = await api.fetch('https://vitareq.vercel.app/api/requirements', {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
    });

    const ct = reqResp.headers.get('content-type') || '';
    if (!reqResp.ok) {
      const txt = ct.includes('application/json') ? JSON.stringify(await reqResp.json()) : await reqResp.text();
      console.error('[importRequirements] Vitareq API error', reqResp.status, txt);
      return { success: false, error: `Vitareq API failed (${reqResp.status})` };
    }

    const payload = ct.includes('application/json') ? await reqResp.json() : await reqResp.text();
    const arr = Array.isArray(payload)
      ? payload
      : (Array.isArray(payload?.requirements)
        ? payload.requirements
        : (Array.isArray(payload?.items)
          ? payload.items
          : (Array.isArray(payload?.data) ? payload.data : [])));

    console.log('[importRequirements] fetched requirement count', arr.length);

    const objects = arr.map((r, index) => {
      const requirementId = (r?.id ?? r?.requirementNumber ?? r?.key ?? String(index)).toString();
      const title = r?.title ?? r?.name ?? r?.requirementNumber ?? `Requirement ${requirementId}`;
      const url = r?.url ?? `https://vitareq.vercel.app/requirements/${encodeURIComponent(requirementId)}`;
      const status = r?.status ?? 'OPEN';
      const description = r?.description ?? r?.text;
      return {
        schemaVersion: '2.0',
        id: requirementId,
        updateSequenceNumber: baseUpdateSeq + index,
        displayName: title,
        url,
        createdAt: nowIso,
        lastUpdatedAt: nowIso,
        description,
        permissions: {
          accessControls: [
            { principals: [{ type: 'ATLASSIAN_WORKSPACE' }] }
          ],
        },
        containerKey: {
          type: 'atlassian:space',
          value: { entityId: 'vitareq' },
        },
        'atlassian:work-item': {
          subtype: 'ISSUE',
          status,
          team: 'vitareq',
        },
      };
    });
    console.log('[importRequirements] first object preview', objects[0]);

    console.log('[importRequirements] calling graph.setObjects, objects:', objects.length);
    const response = await graph.setObjects({
      objects,
      properties: { source: 'vitareq-forge', timestamp: String(baseUpdateSeq) },
    });
    console.log('[importRequirements] response', {
      success: response?.success,
      hasResults: !!response?.results,
      acceptedCount: response?.results?.accepted?.length,
      rejectedCount: response?.results?.rejected?.length,
      validCount: response?.results?.validObjects?.length,
      error: response?.error,
    });

    return { success: response?.success === true, results: response?.results, objects };
  } catch (e) {
    try {
      console.error('[importRequirements] error', e?.message || e, e?.stack);
    } catch (_) {
      // ignore
    }
    return { success: false, error: e?.message || 'Failed to import requirements' };
  }
});

resolver.define('getObjectByExternalId', async (req) => {
  try {
    const objectType = String(req?.payload?.objectType || '').trim();
    const externalId = String(req?.payload?.externalId || '').trim();
    console.log('[getObjectByExternalId] request', { objectType, externalId });

    if (!objectType) {
      return { success: false, error: 'objectType is required' };
    }
    if (!externalId) {
      return { success: false, error: 'externalId is required' };
    }

    const response = await graph.getObjectByExternalId({ objectType, externalId });
    console.log('[getObjectByExternalId] response', {
      success: response?.success,
      hasObject: !!response?.object,
      error: response?.error,
    });

    return response;
  } catch (e) {
    console.error('[getObjectByExternalId] error', e?.message || e, e?.stack);
    return { success: false, error: e?.message || 'Failed to get object by external id' };
  }
});

resolver.define('deleteByProperties', async () => {
  try {
    const request = { properties: { source: 'vitareq-forge' }, objectType: 'atlassian:work-item' };
    console.log('[deleteByProperties] request', request);
    const response = await graph.deleteObjectsByProperties(request);
    console.log('[deleteByProperties] response', { success: response?.success, error: response?.error });
    return response;
  } catch (e) {
    console.error('[deleteByProperties] error', e?.message || e, e?.stack);
    return { success: false, error: e?.message || 'Delete failed' };
  }
});

resolver.define('fetchRequirementsCC', async () => {
  try {
    const clientId = await kvs.getSecret('vitareq:active:clientId');
    const clientSecret = await kvs.getSecret('vitareq:active:clientSecret');
    const tokenUrl = 'https://dev-yfve51b1ewip55b8.us.auth0.com/oauth/token';
    const audience = 'https://vitareq.api';

    if (!clientId || !clientSecret) {
      console.error('[fetchRequirementsCC] Missing client credentials in KVS');
      return { success: false, error: 'Missing client credentials' };
    }

    console.log('[fetchRequirementsCC] Requesting client credentials token');
    const tokenResp = await api.fetch(tokenUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({
        client_id: clientId,
        client_secret: clientSecret,
        audience,
        grant_type: 'client_credentials',
      }),
    });

    if (!tokenResp.ok) {
      const txt = await tokenResp.text();
      console.error('[fetchRequirementsCC] Token error', tokenResp.status, txt);
      return { success: false, error: `Token request failed (${tokenResp.status})` };
    }

    const tokenJson = await tokenResp.json();
    const accessToken = tokenJson?.access_token;
    if (!accessToken) {
      console.error('[fetchRequirementsCC] No access_token in response', tokenJson);
      return { success: false, error: 'No access_token in token response' };
    }

    console.log('[fetchRequirementsCC] Token acquired, fetching requirements');
    const reqResp = await api.fetch('https://vitareq.vercel.app/api/requirements', {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: 'application/json',
      },
    });

    const ct = reqResp.headers.get('content-type') || '';
    if (!reqResp.ok) {
      const txt = ct.includes('application/json') ? JSON.stringify(await reqResp.json()) : await reqResp.text();
      console.error('[fetchRequirementsCC] Vitareq API error', reqResp.status, txt);
      return { success: false, error: `Vitareq API failed (${reqResp.status})` };
    }

    const payload = ct.includes('application/json') ? await reqResp.json() : await reqResp.text();
    let count = 0;
    if (Array.isArray(payload)) count = payload.length;
    else if (Array.isArray(payload?.requirements)) count = payload.requirements.length;
    else if (Array.isArray(payload?.items)) count = payload.items.length;
    else if (Array.isArray(payload?.data)) count = payload.data.length;
    else if (payload && typeof payload === 'object') count = 1;

    console.log('[fetchRequirementsCC] Fetch complete', { count });
    return { success: true, count, preview: Array.isArray(payload) ? payload.slice(0, 2) : payload };
  } catch (e) {
    console.error('[fetchRequirementsCC] error', e?.message || e, e?.stack);
    return { success: false, error: e?.message || 'Failed to fetch requirements' };
  }
});

resolver.define('listRequirements', async () => {
  try {
    const vitareq = api.asUser().withProvider('vitareq', 'vitareq-api');
    if (!(await vitareq.hasCredentials())) {
      await vitareq.requestCredentials();
    }
    const resp = await vitareq.fetch(`/api/requirements`, {
      headers: { Accept: 'application/json' },
    });
    if (!resp.ok) {
      const errorBody = await resp.text();
      console.error('listRequirements error', resp.status, errorBody);
      return { success: false, error: `Failed (${resp.status})` };
    }
    const contentType = resp.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      return { success: false, error: 'Unexpected response' };
    }
    const data = await resp.json();
    const arr = Array.isArray(data) ? data : (Array.isArray(data?.requirements) ? data.requirements : []);
    const items = arr.map((r) => ({
      id: r?.id ?? r?.requirementNumber ?? r?.key,
      title: r?.title ?? r?.name ?? r?.requirementNumber ?? 'Requirement',
      requirementNumber: r?.requirementNumber,
    })).filter((x) => !!x.id);
    return { success: true, items };
  } catch (e) {
    console.error('listRequirements exception', e);
    return { success: false, error: 'Error' };
  }
});

resolver.define('linkRequirement', async (req) => {
  try {
    const requirementId = req?.payload?.requirementId;
    const issueKey = req?.context?.extension?.issue?.key
      ?? req?.context?.extension?.issueKey
      ?? req?.context?.issue?.key;
    if (!requirementId) {
      return { success: false, error: 'requirementId is required' };
    }
    if (!issueKey) {
      return { success: false, error: 'Issue key unavailable' };
    }
    const vitareq = api.asUser().withProvider('vitareq', 'vitareq-api');
    if (!(await vitareq.hasCredentials())) {
      await vitareq.requestCredentials();
    }
    const resp = await vitareq.fetch(`/api/requirements/${encodeURIComponent(requirementId)}`, {
      method: 'PUT',
      headers: { Accept: 'application/json', 'Content-Type': 'application/json' },
      body: JSON.stringify({ jiraKey: issueKey }),
    });
    const ct = resp.headers.get('content-type') || '';
    if (!resp.ok) {
      const body = ct.includes('application/json') ? JSON.stringify(await resp.json()) : await resp.text();
      console.error('linkRequirement error', resp.status, body);
      return { success: false, error: `Failed (${resp.status})` };
    }
    const updated = ct.includes('application/json') ? await resp.json() : null;
    return { success: true, requirement: updated };
  } catch (e) {
    console.error('linkRequirement exception', e);
    return { success: false, error: 'Error' };
  }
});

resolver.define('getActiveCredentials', async () => {
  try {
    const clientId = await kvs.getSecret('vitareq:active:clientId');
    const clientSecret = await kvs.getSecret('vitareq:active:clientSecret');
    const mask = (s) => {
      if (!s || typeof s !== 'string') return undefined;
      return s.length > 4 ? `${s.slice(0, 2)}***${s.slice(-2)}` : '***';
    };
    return { success: true, clientId, clientSecretMasked: mask(clientSecret) };
  } catch (e) {
    console.error('[getActiveCredentials] error', e?.message || e);
    return { success: false };
  }
});

export const handler = resolver.getDefinitions();
