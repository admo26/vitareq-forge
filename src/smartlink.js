import api from "@forge/api";

function mapRequirementToEntity(requirement) {
  const id = requirement.id || requirement.requirementNumber || requirement.url;
  const displayName = requirement.title || requirement.requirementNumber || "Requirement";
  const url = requirement.web_url || requirement.url;
  const createdAt = requirement.createdAt || new Date().toISOString();
  const lastUpdatedAt = requirement.updatedAt || createdAt;
  const description = requirement.description || "";

  return {
    id,
    updateSequenceNumber: Date.now(),
    displayName,
    description,
    url,
    createdAt,
    lastUpdatedAt,
    "atlassian:work-item": {
      status: requirement.status || undefined,
      dueDate: requirement.dueDate || undefined,
      // Additional optional fields like assignee, project, team can be added later
    },
  };
}

export const handler = async (request) => {
  // request.payload.urls: array of URLs
  const urls = request?.payload?.urls || [];
  const results = await Promise.all(urls.map(async (u) => {
    try {
      // Parse requirement id from URL
      const match = u.match(/\/requirements\/([A-Za-z0-9_-]+)/);
      const id = match ? match[1] : undefined;
      console.log("smartlink resolve url:", u, "parsed id:", id);
      let requirement = undefined;

      if (id) {
        const vitareq = api.asUser().withProvider("vitareq", "vitareq-api");
        if (!(await vitareq.hasCredentials())) {
          await vitareq.requestCredentials();
        }
        const resp = await vitareq.fetch(`/api/requirements/${encodeURIComponent(id)}`, {
          headers: { Accept: "application/json" },
        });
        if (resp.ok && (resp.headers.get("content-type") || "").includes("application/json")) {
          requirement = await resp.json();
        }
      }

      console.log("smartlink fetched requirement:", requirement);
      const entity = requirement ? mapRequirementToEntity(requirement) : undefined;
      console.log("smartlink mapped entity:", entity);
      return {
        identifier: { url: u },
        meta: { access: "granted", visibility: "restricted" },
        ...(entity ? { entity } : {}),
      };
    } catch (e) {
      console.error("smartlink resolver error", e);
      return {
        identifier: { url: u },
        meta: { access: "unauthorized", visibility: "restricted" },
      };
    }
  }));

  console.log("smartlink entities response:", results);
  return { entities: results };
};


