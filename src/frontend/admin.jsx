import React, { useState, useEffect } from 'react';
import ForgeReconciler, { Box, Button, Code, CodeBlock, Heading, SectionMessage, Stack, Text, Textfield, Inline, Label, Select } from '@forge/react';
import { invoke } from '@forge/bridge';

const AdminApp = () => {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [externalId, setExternalId] = useState(null);
  const [userExternalId, setUserExternalId] = useState('google-oauth2|107406112376104028774');
  const [userLookup, setUserLookup] = useState(null);
  const [importEntityIds, setImportEntityIds] = useState([]);
  const [lookup, setLookup] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState(null);
  const [ccLoading, setCcLoading] = useState(false);
  const [ccResult, setCcResult] = useState(null);
  const [creds, setCreds] = useState(null);
  const clearAllResults = () => {
    setResult(null);
    setLookup(null);
    setDeleteResult(null);
    setCcResult(null);
    setUserLookup(null);
  };

  const onImport = async () => {
    setImporting(true);
    clearAllResults();
    try {
      const res = await invoke('importRequirements');
      setResult(res);
      try {
        // Populate entityIds from accepted results; fallback to objects ids
        const toEntityIdString = (raw) => {
          if (!raw) return undefined;
          if (typeof raw === 'string') return raw;
          if (typeof raw === 'object') {
            if (typeof raw.id === 'string') return raw.id;
            if (typeof raw.entityId === 'string') return raw.entityId;
          }
          return undefined;
        };
        const extractAcceptedId = (a) => {
          return (
            toEntityIdString(a?.entityId) ||
            toEntityIdString(a?.key?.entityId)
          );
        };
        let ids = Array.isArray(res?.results?.accepted)
          ? res.results.accepted.map(extractAcceptedId).filter(Boolean)
          : [];
        if (ids.length === 0 && Array.isArray(res?.objects)) {
          ids = res.objects.map(o => o?.id).filter(Boolean).map(String);
        }
        const uniqueIds = Array.from(new Set(ids.map(String)));
        setImportEntityIds(uniqueIds);
        if (uniqueIds.length > 0) {
          setExternalId(String(uniqueIds[0]));
        }
      } catch (_) {
        // ignore population errors
      }
    } catch (e) {
      setResult({ success: false, error: e?.message || 'Invocation failed' });
    } finally {
      setImporting(false);
    }
  };

  const onLookup = async () => {
    const objectType = 'atlassian:work-item';
    clearAllResults();
    try {
      const res = await invoke('getObjectByExternalId', { objectType, externalId });
      setLookup(res);
    } catch (e) {
      setLookup({ success: false, error: e?.message || 'Lookup failed' });
    }
  };

  const onDeleteImported = async () => {
    setDeleting(true);
    clearAllResults();
    try {
      const res = await invoke('deleteByProperties');
      setDeleteResult(res);
    } catch (e) {
      setDeleteResult({ success: false, error: e?.message || 'Delete failed' });
    } finally {
      setDeleting(false);
    }
  };

  const onFetchRequirementsCC = async () => {
    setCcLoading(true);
    clearAllResults();
    try {
      const res = await invoke('fetchRequirementsCC');
      setCcResult(res);
    } catch (e) {
      setCcResult({ success: false, error: e?.message || 'Fetch failed' });
    } finally {
      setCcLoading(false);
    }
  };

  const onUserLookup = async () => {
    clearAllResults();
    try {
      const res = await invoke('getUserByExternalId', { externalId: userExternalId });
      setUserLookup(res);
    } catch (e) {
      setUserLookup({ success: false, error: e?.message || 'User lookup failed' });
    }
  };


  useEffect(() => {
    (async () => {
      try {
        const res = await invoke('getActiveCredentials');
        setCreds(res);
      } catch (e) {
        setCreds(null);
      }
    })();
  }, []);

  const AcceptedList = ({ accepted, objects }) => {
    const getEntityType = (a) => a?.entityType || a?.key?.entityType;
    const getEntityId = (a) => {
      if (typeof a?.entityId === 'string') return a.entityId;
      if (typeof a?.key?.entityId === 'string') return a.key.entityId;
      if (typeof a?.entityId?.id === 'string') return a.entityId.id;
      if (typeof a?.key?.entityId?.id === 'string') return a.key.entityId.id;
      return undefined;
    };
    const displayEntityId = (a) => {
      const raw = a?.entityId ?? a?.key?.entityId;
      return typeof raw === 'string' ? raw : JSON.stringify(raw);
    };
    const findObject = (a) => {
      const id = getEntityId(a);
      return Array.isArray(objects) ? objects.find(o => String(o.id) === String(id)) : undefined;
    };
    return (
      <Stack space="space.150" alignInline="start">
        {accepted.map((a, idx) => {
          const obj = findObject(a);
          const header = `${String(getEntityType(a) || 'atlassian:work-item')} — ${displayEntityId(a)}`;
          return (
            <Box key={idx}>
              <Heading size="xsmall">{header}</Heading>
              {obj ? (
                <CodeBlock hasCopyButton={false} text={JSON.stringify(obj, null, 2)} language="json" />
              ) : (
                <Text size="small">Object payload unavailable</Text>
              )}
            </Box>
          );
        })}
      </Stack>
    );
  };

  const RejectedList = ({ rejected }) => (
    <Stack space="space.100" alignInline="start">
      {rejected.map((r, idx) => (
        <Box key={idx}>
          <Text>{`${r.key.entityType} — ${r.key.entityId}`}</Text>
          {Array.isArray(r.errors) && r.errors.length > 0 && (
            <Stack space="space.025">
              {r.errors.map((err, j) => (
                <Text key={j} size="small">{`${err.key}: ${err.message}`}</Text>
              ))}
            </Stack>
          )}
        </Box>
      ))}
    </Stack>
  );

  return (
    <Stack space="space.300" alignInline="start">
      {creds && creds.success && (
        <Stack space="space.050" alignInline="start">
          <Heading size="xsmall">Active credentials</Heading>
          <Label labelFor="clientId">Client ID</Label>
          <Textfield name="clientId" id="clientId" value={String(creds.clientId || '')} isDisabled />
          <Label labelFor="clientSecret">Client Secret</Label>
          <Textfield name="clientSecret" id="clientSecret" value={String(creds.clientSecretMasked || '')} isDisabled />
          <Label labelFor="connectionId">Connection ID</Label>
          <Textfield name="connectionId" id="connectionId" value={String(creds.connectionId || '')} isDisabled />
        </Stack>
      )}
      <Text>Import Vitareq requirements as work items into Teamwork Graph.</Text>
      <Inline space="space.100" alignBlock="center">
        <Button onClick={onFetchRequirementsCC} isDisabled={ccLoading} appearance="primary">
          {ccLoading ? 'Fetching…' : 'Fetch requirements'}
        </Button>
        <Button onClick={onImport} isDisabled={importing} appearance="primary">
          {importing ? 'Importing…' : 'Import'}
        </Button>
        <Button onClick={onDeleteImported} isDisabled={deleting} appearance="danger">
          {deleting ? 'Deleting…' : 'Delete imported'}
        </Button>
      </Inline>
      <Inline space="space.300" alignBlock="start" alignInline="start" shouldWrap={false}>
        <Stack space="space.100" alignInline="start">
          <Heading size="small">Fetch from TWG by External ID (requirementID)</Heading>
          <Label labelFor="externalId">External ID</Label>
          {Array.isArray(importEntityIds) && importEntityIds.length > 0 ? (
            <Select
              value={(() => {
                const importedObjects = Array.isArray(result?.objects) ? result.objects : [];
                const options = importEntityIds.map(id => {
                  const obj = importedObjects.find(o => String(o.id) === String(id));
                  const label = obj ? `${String(id)} — ${String(obj.displayName || obj.id)}` : String(id);
                  return { label, value: id };
                });
                return options.find(o => String(o.value) === String(externalId)) || null;
              })()}
              onChange={(opt) => setExternalId(opt && typeof opt === 'object' && 'value' in opt ? opt.value : '')}
              options={(Array.isArray(result?.objects) ? importEntityIds.map(id => {
                const obj = result.objects.find(o => String(o.id) === String(id));
                const label = obj ? `${String(id)} — ${String(obj.displayName || obj.id)}` : String(id);
                return { label, value: id };
              }) : importEntityIds.map(id => ({ label: String(id), value: id })))}
              placeholder="Select an imported requirement"
              style={{ width: '100%' }}
            />
          ) : (
            <Textfield
              name="externalId"
              id="externalId"
              placeholder="External ID (e.g. req-vitc-500mg)"
              value={externalId}
              onChange={(e) => setExternalId(e?.target?.value || '')}
            />
          )}
          <Button onClick={onLookup} isDisabled={!externalId}>Lookup</Button>
        </Stack>
        <Stack space="space.100" alignInline="start">
          <Heading size="small">Fetch User by External ID</Heading>
          <Label labelFor="userExternalId">User External ID</Label>
          <Textfield
            name="userExternalId"
            id="userExternalId"
            placeholder="External ID (e.g. google-oauth2|107406112376104028774)"
            value={userExternalId}
            onChange={(e) => setUserExternalId(e?.target?.value || '')}
          />
          <Button onClick={onUserLookup} isDisabled={!userExternalId}>Lookup User</Button>
        </Stack>
      </Inline>

      {lookup && lookup.success && (
        <SectionMessage title="Lookup result" appearance="information">
          {lookup.object ? (
            <CodeBlock hasCopyButton={false} text={JSON.stringify(lookup.object, null, 2)} language="json" />
          ) : (
            <Text>No object returned</Text>
          )}
        </SectionMessage>
      )}

      {lookup && !lookup.success && (
        <SectionMessage title="Lookup failed" appearance="error">
          <Text>{String(lookup.error || 'Unknown error')}</Text>
        </SectionMessage>
      )}

      {deleteResult && deleteResult.success && (
        <SectionMessage title="Delete complete" appearance="confirmation">
          <Stack space="space.100" alignInline="start">
            <Text>Deleted objects with property source=vitareq-forge</Text>
            {deleteResult.userDelete && (() => {
              const r = deleteResult.userDelete.results;
              const overall = deleteResult.userDelete.success === true;
              const successCount = Array.isArray(r)
                ? r.filter(x => ((x?.statusCode ?? 0) >= 200 && (x?.statusCode ?? 0) < 300)).length
                : (Array.isArray(r?.success) ? r.success.length : 0);
              const failureCount = Array.isArray(r)
                ? (Array.isArray(r) ? r.length - successCount : 0)
                : (Array.isArray(r?.failures) ? r.failures.length : 0);
              return (
                <Box>
                  <Heading size="xsmall">User deletion</Heading>
                  <Text>{`Success: ${overall} — Deleted: ${successCount} — Failed: ${failureCount}`}</Text>
                </Box>
              );
            })()}
          </Stack>
        </SectionMessage>
      )}

      {deleteResult && !deleteResult.success && (
        <SectionMessage title="Delete failed" appearance="error">
          <Text>{String(deleteResult.error || 'Unknown error')}</Text>
        </SectionMessage>
      )}

      {ccResult && ccResult.success && (
        <SectionMessage title="Client Credentials fetch" appearance="information">
          <Text>Count: {String(ccResult.count)}</Text>
          {ccResult.preview && (
            <CodeBlock hasCopyButton={false} text={JSON.stringify(ccResult.preview, null, 2)} language="json" />
          )}
        </SectionMessage>
      )}

      {userLookup && userLookup.success && userLookup.user && (
        <SectionMessage title="User lookup" appearance="information">
          <CodeBlock hasCopyButton={false} text={JSON.stringify(userLookup.user, null, 2)} language="json" />
        </SectionMessage>
      )}

      {userLookup && userLookup.success && !userLookup.user && (
        <SectionMessage title="User not found" appearance="warning">
          <Text>{`No user found for external ID: ${String(userExternalId || '')}`}</Text>
        </SectionMessage>
      )}

      {userLookup && !userLookup.success && (
        <SectionMessage title="User lookup failed" appearance="error">
          <Text>{String(userLookup.error || 'Unknown error')}</Text>
        </SectionMessage>
      )}

      {ccResult && !ccResult.success && (
        <SectionMessage title="Client Credentials fetch failed" appearance="error">
          <Text>{String(ccResult.error || 'Unknown error')}</Text>
        </SectionMessage>
      )}

      {result && result.success && (
        <SectionMessage title="Import complete" appearance="confirmation">
          <Stack space="space.150" alignInline="start">
            <Text>
              Imported: {String((result.results?.accepted?.length || 0) + (result.results?.validObjects?.length || 0))} of {String(Array.isArray(result?.objects) ? result.objects.length : ((result?.results?.validObjects?.length || 0) + (result?.results?.accepted?.length || 0)))}
            </Text>
            {result.results?.accepted && result.results.accepted.length > 0 && (
              <Box>
                <Heading size="xsmall">Accepted</Heading>
                <AcceptedList accepted={result.results.accepted} objects={result.objects} />
              </Box>
            )}
            {result.results?.rejected && result.results.rejected.length > 0 && (
              <Box>
                <Heading size="xsmall">Rejected</Heading>
                <RejectedList rejected={result.results.rejected} />
              </Box>
            )}
          {result.userResults && (
            <Box>
              <Heading size="xsmall">User ingestion</Heading>
              <Text>
                Success: {String(result.userResults.success?.length || 0)} — Failures: {String(result.userResults.failures?.length || 0)}
              </Text>
            </Box>
          )}
          {result.userMappingResults && (
            <Box>
              <Heading size="xsmall">User mapping</Heading>
              <Text>
                Success: {String(result.userMappingSuccess === true)} — Mapped: {String(
                  Array.isArray(result.userMappingResults)
                    ? result.userMappingResults.filter(r => r?.success).length
                    : (Array.isArray(result.userMappingResults?.success) ? result.userMappingResults.success.length : 0)
                )} — Failed: {String(
                  Array.isArray(result.userMappingResults)
                    ? result.userMappingResults.filter(r => !r?.success).length
                    : (Array.isArray(result.userMappingResults?.failures) ? result.userMappingResults.failures.length : 0)
                )}
              </Text>
            </Box>
          )}
          </Stack>
        </SectionMessage>
      )}

      {result && !result.success && (
        <SectionMessage title="Import failed" appearance="error">
          <Text>{String(result.error || 'Unknown error')}</Text>
        </SectionMessage>
      )}

    </Stack>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <AdminApp />
  </React.StrictMode>
);


