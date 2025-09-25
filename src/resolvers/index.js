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

resolver.define('importRequirements', async (req) => {
  try {
    console.log('[importRequirements] start');
    const useWorkspacePermissions = req?.payload?.workspace === true;
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

    // Project ingestion removed per request

    const objects = arr.map((r, index) => {
      const requirementId = (r?.id ?? r?.requirementNumber ?? r?.key ?? String(index)).toString();
      const title = r?.title ?? r?.name ?? r?.requirementNumber ?? `Requirement ${requirementId}`;
      const url = r?.url ?? `https://vitareq.vercel.app/requirements/${encodeURIComponent(requirementId)}`;
      const status = r?.status ?? 'OPEN';
      const description = (r?.description ?? r?.text ?? title ?? requirementId).toString();
      const permissions = useWorkspacePermissions
        ? {
            accessControls: [
              { principals: [ { type: 'ATLASSIAN_WORKSPACE' } ] }
            ]
          }
        : {
            accessControls: [
              { principals: [ { type: 'USER', id: 'google-oauth2|107406112376104028774' } ] }
            ]
          };
      return {
        schemaVersion: '2.0',
        id: requirementId,
        updateSequenceNumber: baseUpdateSeq + index,
        displayName: title,
        url,
        createdAt: nowIso,
        lastUpdatedAt: nowIso,
        description,
        permissions,

        'atlassian:work-item': {
          subtype: 'TASK',
          status
        },
      };
    });
    console.log('[importRequirements] first object preview', objects[0]);
    if (useWorkspacePermissions) {
      try {
        console.log('[importRequirements] first object JSON (workspace)', JSON.stringify(objects[0], null, 2));
      } catch (_) {
        // ignore stringify errors
      }
    }
    // Also ensure default user exists in Teamwork Graph (skip when workspace-level permissions are used)
    let userResults = undefined;
    let userMappingResults = undefined;
    let userMappingSuccess = undefined;
    if (!useWorkspacePermissions) {
      try {
        console.log('[importRequirements] calling graph.setUsers for default user');
        const user = {
          externalId: 'google-oauth2|107406112376104028774',
          displayName: 'Adam Moore',
          userName: 'amoore',
          name: {
            formatted: 'Adam Moore',
            familyName: 'Moore',
            givenName: 'Adam',
          },
          emails: [
            { value: 'amoore@atlassian.com', primary: true },
          ],
        };
        const setUsersResp = await graph.setUsers({ users: [user] });
        userResults = setUsersResp?.results;
        console.log('[importRequirements] setUsers response', {
          success: setUsersResp?.success,
          successCount: setUsersResp?.results?.success?.length,
          failureCount: setUsersResp?.results?.failures?.length,
          error: setUsersResp?.error,
        });

        // Map the user to email for permissions/collab
        console.log('[importRequirements] calling graph.mapUsers for default user');
        const mapResp = await graph.mapUsers({
          directMappings: [
            {
              externalId: 'google-oauth2|107406112376104028774',
              email: 'amoore@atlassian.com',
              updateSequenceNumber: baseUpdateSeq,
              updatedAt: Date.now(),
            },
          ],
        });
        userMappingResults = mapResp?.results;
        userMappingSuccess = mapResp?.success === true;
        console.log('[importRequirements] mapUsers response', {
          success: mapResp?.success,
          resultsCount: Array.isArray(mapResp?.results) ? mapResp.results.length : 0,
          error: mapResp?.error,
        });
        // Emit detailed logs for mapping outcomes
        try {
          if (Array.isArray(mapResp?.results)) {
            for (const r of mapResp.results) {
              if (r?.success) {
                console.log('[importRequirements] mapUsers success', {
                  externalId: r?.externalId,
                  accountId: r?.accountId,
                  email: r?.email,
                });
              } else {
                console.warn('[importRequirements] mapUsers failure', {
                  externalId: r?.externalId,
                  error: r?.error,
                });
              }
            }
          } else if (mapResp?.results && typeof mapResp.results === 'object') {
            const successes = Array.isArray(mapResp.results.success) ? mapResp.results.success : [];
            const failures = Array.isArray(mapResp.results.failures) ? mapResp.results.failures : [];
            for (const r of successes) {
              console.log('[importRequirements] mapUsers success', {
                externalId: r?.externalId,
                accountId: r?.accountId,
                email: r?.email,
              });
            }
            for (const r of failures) {
              console.warn('[importRequirements] mapUsers failure', {
                externalId: r?.externalId,
                error: r?.error,
              });
            }
          }
        } catch (logErr) {
          console.error('[importRequirements] mapUsers detailed logging error', logErr?.message || logErr);
        }
      } catch (e) {
        console.error('[importRequirements] setUsers error (non-fatal)', e?.message || e);
      }
    } else {
      console.log('[importRequirements] workspace flag set; skipping user ingestion and mapping');
    }

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

    return { success: response?.success === true, results: response?.results, objects, userResults, userMappingResults, userMappingSuccess };
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

resolver.define('getUserByExternalId', async (req) => {
  try {
    const externalId = String(req?.payload?.externalId || '').trim();
    console.log('[getUserByExternalId] request', { externalId });

    if (!externalId) {
      return { success: false, error: 'externalId is required' };
    }

    const response = await graph.getUserByExternalId({ externalId });
    console.log('[getUserByExternalId] response', {
      success: response?.success,
      hasUser: !!response?.user,
      error: response?.error,
    });
    return response;
  } catch (e) {
    console.error('[getUserByExternalId] error', e?.message || e, e?.stack);
    return { success: false, error: e?.message || 'Failed to get user by external id' };
  }
});

resolver.define('deleteByProperties', async () => {
  try {
    const baseProps = { properties: { source: 'vitareq-forge' } };

    // Delete work items
    const workItemRequest = { ...baseProps, objectType: 'atlassian:work-item' };
    console.log('[deleteByProperties] deleting work-items with', workItemRequest);
    const workItemDelete = await graph.deleteObjectsByProperties(workItemRequest);

    // Delete documents
    const documentRequest = { ...baseProps, objectType: 'atlassian:document' };
    console.log('[deleteByProperties] deleting documents with', documentRequest);
    const documentDelete = await graph.deleteObjectsByProperties(documentRequest);

    // Attempt to also delete the default user by externalId
    let userDelete = undefined;
    try {
      const userExternalIds = ['google-oauth2|107406112376104028774'];
      console.log('[deleteByProperties] preparing to delete users by externalId', { userExternalIds });

      // Pre-delete existence checks
      for (const extId of userExternalIds) {
        try {
          const pre = await graph.getUserByExternalId({ externalId: extId });
          console.log('[deleteByProperties] pre-delete lookup', {
            externalId: extId,
            success: pre?.success,
            found: !!pre?.user,
            error: pre?.error,
          });
        } catch (lookupErr) {
          console.warn('[deleteByProperties] pre-delete lookup error', {
            externalId: extId,
            error: lookupErr?.message || lookupErr,
          });
        }
      }

      userDelete = await graph.deleteUsersByExternalId({ externalIds: userExternalIds });
      console.log('[deleteByProperties] user delete response (summary)', {
        success: userDelete?.success,
        successCount: userDelete?.results?.success?.length,
        failureCount: userDelete?.results?.failures?.length,
        error: userDelete?.error,
      });

      // Detailed per-id results
      try {
        if (Array.isArray(userDelete?.results)) {
          for (const r of userDelete.results) {
            if (r?.statusCode && r.statusCode >= 200 && r.statusCode < 300) {
              console.log('[deleteByProperties] user deleted', { externalId: r?.externalId, statusCode: r?.statusCode });
            } else {
              console.warn('[deleteByProperties] user delete failed', { externalId: r?.externalId, statusCode: r?.statusCode, error: r?.error });
            }
          }
        } else {
          const successes = Array.isArray(userDelete?.results?.success) ? userDelete.results.success : [];
          const failures = Array.isArray(userDelete?.results?.failures) ? userDelete.results.failures : [];
          for (const r of successes) {
            console.log('[deleteByProperties] user deleted', { externalId: r?.externalId, statusCode: r?.statusCode });
          }
          for (const r of failures) {
            console.warn('[deleteByProperties] user delete failed', { externalId: r?.externalId, statusCode: r?.statusCode, error: r?.error });
          }
        }
      } catch (detailErr) {
        console.error('[deleteByProperties] error logging user delete details', detailErr?.message || detailErr);
      }
    } catch (e) {
      console.error('[deleteByProperties] user delete error (non-fatal)', e?.message || e);
    }

    console.log('[deleteByProperties] summary', {
      workItems: { success: workItemDelete?.success, error: workItemDelete?.error },
      documents: { success: documentDelete?.success, error: documentDelete?.error },
      users: { success: userDelete?.success, error: userDelete?.error },
    });
    return { success: (workItemDelete?.success === true && documentDelete?.success === true), workItemDelete, documentDelete, userDelete };
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
    const connectionId = await kvs.getSecret('vitareq:active:connectionId');
    const mask = (s) => {
      if (!s || typeof s !== 'string') return undefined;
      return s.length > 4 ? `${s.slice(0, 2)}***${s.slice(-2)}` : '***';
    };
    return { success: true, clientId, clientSecretMasked: mask(clientSecret), connectionId };
  } catch (e) {
    console.error('[getActiveCredentials] error', e?.message || e);
    return { success: false };
  }
});

resolver.define('importUser', async () => {
  try {
    console.log('[importUser] start');
    const user = {
      externalId: 'google-oauth2|107406112376104028774',
      displayName: 'Adam Moore',
      userName: 'amoore',
      name: {
        formatted: 'Adam Moore',
        familyName: 'Moore',
        givenName: 'Adam'
      },
      emails: [
        { value: 'amoore@atlassian.com', primary: true }
      ]
    };
    console.log('[importUser] calling graph.setUsers');
    const response = await graph.setUsers({ users: [user] });
    console.log('[importUser] response', {
      success: response?.success,
      successCount: response?.results?.success?.length,
      failureCount: response?.results?.failures?.length,
      error: response?.error
    });
    return response;
  } catch (e) {
    console.error('[importUser] error', e?.message || e, e?.stack);
    return { success: false, error: e?.message || 'Failed to import user' };
  }
});

resolver.define('importTestDoc', async () => {
  try {
    console.log('[importTestDoc] start');
    const now = Date.now();
    const doc = {
      schemaVersion: '1.0',
      id: 'VREQ-021',
      updateSequenceNumber: 2,
      displayName: '[VREQ-021] Shelf-life prediction using real-time sensor data',
      url: 'https://vitareq.vercel.app/requirements/cmfxwi6800000jr0475qj46ck',
      createdAt: '2024-04-20T14:20:00.000Z',
      permissions: [
        {
          accessControls: [
            {
              principals: [
                { type: 'ATLASSIAN_WORKSPACE' }
              ]
            }
          ]
        }
      ],
      lastUpdatedAt: '2024-04-21T08:10:00.000Z',
      'atlassian:document': {
        type: {
          category: 'DOCUMENT',
          mimeType: 'text/plain'
        },
        content: {
          mimeType: 'text/plain',
          text: `Omega-3 gummies are highly sensitive to both oxidation and environmental conditions such as temperature and humidity. Traditional stability studies provide useful but static results, often lagging behind real production timelines. By combining real-time data from warehouse sensors with lab assay results, the system can deliver more accurate, dynamic predictions of product shelf life. This ensures early detection of degradation trends and helps the quality team make faster, better-informed decisions.
          The predictive capability will operate on a weekly cycle, ingesting the latest environmental readings (temperature, humidity) and chemical stability data (oxidation levels, potency assays). A regression or machine-learning model will generate updated shelf-life predictions, including confidence intervals. These results will be visible within VitaReq and linked Jira issues, so engineering and QA can track them alongside development and mitigation work.

          This requirement is also critical for compliance and customer trust. Regulatory authorities increasingly expect proactive risk monitoring rather than reactive responses. Having predictive shelf-life data available in audit trails, regulatory dossiers, and Confluence pages strengthens Vitafleet’s ability to demonstrate product safety and stability. For the Omega-3 Gummies V2 launch, this capability is a cornerstone of the broader goal to reduce recall risk by 50% before market release.`
        }
      }
    };

    const response = await graph.setObjects({
      objects: [doc],
      properties: { source: 'vitareq-forge', timestamp: String(now) },
    });

    console.log('[importTestDoc] response', {
      success: response?.success,
      accepted: response?.results?.accepted?.length,
      rejected: response?.results?.rejected?.length,
      error: response?.error,
    });

    return { success: response?.success === true, results: response?.results, objects: [doc] };
  } catch (e) {
    console.error('[importTestDoc] error', e?.message || e, e?.stack);
    return { success: false, error: e?.message || 'Failed to import test document' };
  }
});

resolver.define('importTestWorkItem', async () => {
  try {
    console.log('[importTestWorkItem] start');
    const now = new Date();
    const nowIso = now.toISOString();
    const updateSeq = Date.now();
    const obj = {
      "schemaVersion": "2.0",
      "id": "cmfxwi6800000jr0475qj46ck",
      "updateSequenceNumber": 1758762885147,
      "displayName": "Shelf-life prediction using real-time sensor data",
      "url": "https://vitareq.vercel.app/api/requirements/cmfxwi6800000jr0475qj46ck",
      "createdAt": "2025-09-25T01:14:45.145Z",
      "lastUpdatedAt": "2025-09-25T01:14:45.145Z",
      "description": "Omega-3 gummies are highly sensitive to both oxidation and environmental conditions such as temperature and humidity. Traditional stability studies provide useful but static results, often lagging behind real production timelines. By combining real-time data from warehouse sensors with lab assay results, the system can deliver more accurate, dynamic predictions of product shelf life. This ensures early detection of degradation trends and helps the quality team make faster, better-informed decisions.\n\nThe predictive capability will operate on a weekly cycle, ingesting the latest environmental readings (temperature, humidity) and chemical stability data (oxidation levels, potency assays). A regression or machine-learning model will generate updated shelf-life predictions, including confidence intervals. These results will be visible within VitaReq and linked Jira issues, so engineering and QA can track them alongside development and mitigation work.\n\nThis requirement is also critical for compliance and customer trust. Regulatory authorities increasingly expect proactive risk monitoring rather than reactive responses. Having predictive shelf-life data available in audit trails, regulatory dossiers, and Confluence pages strengthens Vitafleet’s ability to demonstrate product safety and stability. For the Omega-3 Gummies V2 launch, this capability is a cornerstone of the broader goal to reduce recall risk by 50% before market release.",
      "permissions": {
        "accessControls": [
          {
            "principals": [
              {
                "type": "ATLASSIAN_WORKSPACE"
              }
            ]
          }
        ]
      },
      "atlassian:work-item": {
        "subtype": "TASK",
        "status": "TO_DO"
      }
    };

    // Call the graph.setObjects API to import the work item object
    const response = await graph.setObjects({
      objects: [obj],
      properties: { source: 'vitareq-forge', timestamp: String(updateSeq) },
    });

    console.log('[importTestWorkItem] response', {
      success: response?.success,
      accepted: response?.results?.accepted?.length,
      rejected: response?.results?.rejected?.length,
      error: response?.error,
    });

    return { success: response?.success === true, results: response?.results, objects: [obj] };
  } catch (e) {
    console.error('[importTestWorkItem] error', e?.message || e, e?.stack);
    return { success: false, error: e?.message || 'Failed to import test work item' };
  }
});

export const handler = resolver.getDefinitions();
