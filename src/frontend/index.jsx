import React, { useEffect, useState } from 'react';
import ForgeReconciler, { Text, Heading, SectionMessage, Link, Lozenge, Stack } from '@forge/react';
import { invoke } from '@forge/bridge';

const App = () => {
  const [data, setData] = useState(null);
  useEffect(() => {
    invoke('getText', { example: 'my-invoke-variable' }).then((result) => {
      console.log('Requirement from resolver:', result);
      setData(result);
    });
  }, []);
  const RequirementView = ({ req }) => {
    if (!req || typeof req !== 'object') {
      return <Text>Invalid requirement data</Text>;
    }

    const {
      requirementNumber,
      title,
      description,
      status,
      owner,
      dueDate,
      url,
      web_url,
      createdAt,
      updatedAt,
      id,
    } = req;

    const formatDate = (value) => {
      if (!value) return null;
      const d = new Date(value);
      return Number.isNaN(d.getTime()) ? String(value) : d.toLocaleDateString();
    };

    const headingText = requirementNumber
      ? `${requirementNumber}${title ? ` — ${title}` : ''}`
      : (title || `Requirement ${id ?? ''}`);

    const getLozengeAppearance = (value) => {
      const s = String(value || '').toLowerCase();
      if (['approved', 'success', 'resolved', 'done', 'completed', 'accepted'].includes(s)) return 'success';
      if (['removed', 'declined', 'rejected', 'failed', 'error'].includes(s)) return 'removed';
      if (['in progress', 'in_progress', 'inprogress', 'open', 'ongoing', 'pending'].includes(s)) return 'inprogress';
      if (['new', 'created', 'help'].includes(s)) return 'new';
      if (['moved', 'blocked', 'warning', 'busy', 'missing'].includes(s)) return 'moved';
      return 'default';
    };

    return (
      <Stack space="space.200" alignInline="start">
        <Heading size="small">
          {(() => { const linkHref = web_url || url; return linkHref ? (
            <Link href={String(linkHref)}>{headingText}</Link>
          ) : (
            headingText
          ); })()}
        </Heading>
        {status && (
          <Lozenge appearance={getLozengeAppearance(status)} isBold>
            {String(status)}
          </Lozenge>
        )}
        {(dueDate || description || createdAt || updatedAt) && (
          <Stack space="space.050" alignInline="start">
            {dueDate && <Text>Due: {formatDate(dueDate)}</Text>}
            {description && <Text>{description}</Text>}
            {(createdAt || updatedAt) && (
              <Text size="small">
                {createdAt ? `Created: ${formatDate(createdAt)}` : ''}
                {createdAt && updatedAt ? ' · ' : ''}
                {updatedAt ? `Updated: ${formatDate(updatedAt)}` : ''}
              </Text>
            )}
          </Stack>
        )}
      </Stack>
    );
  };

  return (
    <>
      {!data && <Text>Loading...</Text>}
      {data && typeof data === 'object' && 'error' in data && (
        <SectionMessage title="Failed to load" appearance="error">
          <Text>{String(data.error)}</Text>
        </SectionMessage>
      )}
      {data && typeof data === 'object' && !('error' in data) && (
        <RequirementView req={data} />
      )}
      {data && typeof data !== 'object' && (
        <Text>{String(data)}</Text>
      )}
    </>
  );
};

ForgeReconciler.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
