import api from "@forge/api";

function mapRequirementStatusToAppearance(status) {
  const s = String(status || "").toLowerCase().replace(/\s+/g, "_");
  if (s === "draft") return "new";
  if (s === "in_review") return "inprogress";
  if (s === "approved") return "success";
  if (s === "archived") return "default";
  return "default";
}

export const handler = async (payload) => {
  try {
    const issueKey = payload?.extension?.issue?.key
      ?? payload?.issueKey
      ?? payload?.context?.issue?.key;

    if (!issueKey) {
      return { status: { type: "lozenge", value: { label: "", type: "default" } } };
    }

    const vitareq = api.asUser().withProvider("vitareq", "vitareq-api");
    if (!(await vitareq.hasCredentials())) {
      await vitareq.requestCredentials();
    }

    const response = await vitareq.fetch(`/api/requirements?jiraKey=${encodeURIComponent(issueKey)}`, {
      headers: { Accept: "application/json" },
    });

    if (!response.ok) {
      return { status: { type: "lozenge", value: { label: "", type: "default" } } };
    }

    const contentType = response.headers.get("content-type") || "";
    if (!contentType.includes("application/json")) {
      return { status: { type: "lozenge", value: { label: "", type: "default" } } };
    }

    const data = await response.json();
    const requirement = Array.isArray(data)
      ? data[0]
      : (Array.isArray(data?.requirements) ? data.requirements[0] : data);

    const reqNumber = requirement?.requirementNumber ? String(requirement.requirementNumber) : "";
    const appearance = mapRequirementStatusToAppearance(requirement?.status);
    console.log("dynamicProperties reqNumber:", reqNumber, "status:", requirement?.status, "appearance:", appearance, "for issue:", issueKey);
    return { status: { type: "lozenge", value: { label: reqNumber, type: appearance } } };
  } catch (err) {
    console.error("dynamicProperties error", err);
    return { status: { type: "lozenge", value: { label: "", type: "default" } } };
  }
};


