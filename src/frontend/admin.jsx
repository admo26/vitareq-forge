import React, { useState, useEffect } from 'react';
import ForgeReconciler, { Box, Button, Code, CodeBlock, Heading, SectionMessage, Stack, Text, Textfield, Inline, Label } from '@forge/react';
import { invoke } from '@forge/bridge';

const AdminApp = () => {
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState(null);
  const [externalId, setExternalId] = useState('req-vitc-500mg');
  const [lookup, setLookup] = useState(null);
  const [deleting, setDeleting] = useState(false);
  const [deleteResult, setDeleteResult] = useState(null);
  const [ccLoading, setCcLoading] = useState(false);
  const [ccResult, setCcResult] = useState(null);
  const [creds, setCreds] = useState(null);

  const onImport = async () => {
    console.log('[Admin] Import clicked');
    setImporting(true);
    setResult(null);
    // Clear other results so only current action output is shown
    setLookup(null);
    setDeleteResult(null);
    setCcResult(null);
    try {
      console.log('[Admin] invoking importRequirements');
      const res = await invoke('importRequirements');
      console.log('[Admin] invoke result', res);
      setResult(res);
    } catch (e) {
      console.error('[Admin] invoke error', e);
      setResult({ success: false, error: e?.message || 'Invocation failed' });
    } finally {
      setImporting(false);
      console.log('[Admin] Import finished');
    }
  };

  const onLookup = async () => {
    const objectType = 'atlassian:work-item';
    console.log('[Admin] Lookup clicked', { objectType, externalId });
    setLookup(null);
    // Clear other results so only current action output is shown
    setResult(null);
    setDeleteResult(null);
    setCcResult(null);
    try {
      const res = await invoke('getObjectByExternalId', { objectType, externalId });
      console.log('[Admin] lookup result', res);
      setLookup(res);
    } catch (e) {
      console.error('[Admin] lookup error', e);
      setLookup({ success: false, error: e?.message || 'Lookup failed' });
    }
  };

  const onDeleteImported = async () => {
    console.log('[Admin] Delete imported clicked');
    setDeleting(true);
    setDeleteResult(null);
    // Clear other results so only current action output is shown
    setResult(null);
    setLookup(null);
    setCcResult(null);
    try {
      const res = await invoke('deleteByProperties');
      console.log('[Admin] delete result', res);
      setDeleteResult(res);
    } catch (e) {
      console.error('[Admin] delete error', e);
      setDeleteResult({ success: false, error: e?.message || 'Delete failed' });
    } finally {
      setDeleting(false);
    }
  };

  const onFetchRequirementsCC = async () => {
    console.log('[Admin] Fetch requirements (client credentials)');
    setCcLoading(true);
    setCcResult(null);
    // Clear other results so only current action output is shown
    setResult(null);
    setLookup(null);
    setDeleteResult(null);
    try {
      const res = await invoke('fetchRequirementsCC');
      console.log('[Admin] CC fetch result', res);
      setCcResult(res);
    } catch (e) {
      console.error('[Admin] CC fetch error', e);
      setCcResult({ success: false, error: e?.message || 'Fetch failed' });
    } finally {
      setCcLoading(false);
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
    const findObject = (a) => {
      // entityId is usually the object's id
      const id = a?.entityId;
      return Array.isArray(objects) ? objects.find(o => o.id === id) : undefined;
    };
    return (
      <Stack space="space.150" alignInline="start">
        {accepted.map((a, idx) => {
          const obj = findObject(a);
          return (
            <Box key={idx}>
              <Heading size="xsmall">{`${a.entityType} — ${a.entityId}`}</Heading>
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
        </Stack>
      )}
      <Text>Import Vitareq requirements as work items into Teamwork Graph.</Text>
      <Inline space="space.100" alignBlock="center">
        <Button onClick={onImport} isDisabled={importing} appearance="primary">
          {importing ? 'Importing…' : 'Import'}
        </Button>
        <Button onClick={onFetchRequirementsCC} isDisabled={ccLoading} appearance="primary">
          {ccLoading ? 'Fetching…' : 'Fetch requirements (CC)'}
        </Button>
        <Button onClick={onDeleteImported} isDisabled={deleting} appearance="danger">
          {deleting ? 'Deleting…' : 'Delete imported'}
        </Button>
      </Inline>
      <Heading size="small">Lookup by External ID</Heading>
      <Stack space="space.100" alignInline="start">
        <Label labelFor="externalId">External ID</Label>
        <Textfield
          name="externalId"
          id="externalId"
          placeholder="External ID (e.g. req-vitc-500mg)"
          value={externalId}
          onChange={(e) => setExternalId(e?.target?.value || '')}
        />
        <Button onClick={onLookup} isDisabled={!externalId}>Lookup</Button>
      </Stack>

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
          <Text>Deleted objects with property source=vitareq-forge</Text>
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

      {ccResult && !ccResult.success && (
        <SectionMessage title="Client Credentials fetch failed" appearance="error">
          <Text>{String(ccResult.error || 'Unknown error')}</Text>
        </SectionMessage>
      )}

      {result && result.success && (
        <SectionMessage title="Import complete" appearance="confirmation">
          <Stack space="space.150" alignInline="start">
            <Text>Imported: {String(result.results?.accepted?.length || 0)}</Text>
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


