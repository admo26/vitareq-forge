import api from "@forge/api";

export async function fetchRequirements({ payload }) {
  try {
    const jiraKey = payload?.inputs?.jiraKey;
    if (!jiraKey) {
      return { output: "jiraKey is required", data: [] };
    }

    const vitareq = api.asUser().withProvider("vitareq", "vitareq-api");
    if (!(await vitareq.hasCredentials())) {
      await vitareq.requestCredentials();
    }

    const resp = await vitareq.fetch(`/api/requirements?jiraKey=${encodeURIComponent(jiraKey)}`, {
      headers: { Accept: "application/json" },
    });

    if (!resp.ok) {
      const errorBody = await resp.text();
      console.error("Rovo fetchRequirements error", resp.status, errorBody);
      return { output: `Failed: ${resp.status}`, data: [] };
    }

    const contentType = resp.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return { output: "Unexpected response", data: [] };
    }

    const data = await resp.json();
    const requirement = Array.isArray(data)
      ? data[0]
      : (Array.isArray(data?.requirements) ? data.requirements[0] : data);

    return {
      output: requirement?.requirementNumber
        ? `Found requirement ${requirement.requirementNumber}`
        : "No requirement found",
      data: requirement ? [requirement] : [],
    };
  } catch (e) {
    console.error("Rovo fetchRequirements exception", e);
    return { output: "Error", data: [] };
  }
}

export async function createRequirement({ payload }) {
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

export async function updateRequirement({ payload }) {
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

