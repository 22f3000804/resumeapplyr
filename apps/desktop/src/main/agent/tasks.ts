// What each button in the app asks the agent to do.
import type { Campaign } from "../services/campaigns";
import type { ResumeDetail } from "../services/resumes";
import type { AgentTask } from "./runner";

const boardName = (domain: string | undefined) => domain ?? "the board";

/** "Run" on a campaign: search, or search and apply, or score pasted links. */
export function campaignTask(campaign: Campaign): AgentTask {
  const { id, query, config, source } = campaign;
  if (source === "apply") {
    return { skill: "apply", args: `campaign ${id}`, title: `Apply to links: ${query}`, campaignId: id };
  }
  const base = `${query} --board ${config.board} --campaign ${id}`;
  if (source === "search") {
    return {
      skill: "search",
      args: config.maxJobs ? `${base} --max-jobs ${config.maxJobs}` : base,
      title: `Search ${boardName(config.board)}: ${query}`,
      campaignId: id,
    };
  }
  return { skill: "auto-apply", args: base, title: `Find and apply on ${boardName(config.board)}: ${query}`, campaignId: id };
}

/** "Apply to approved" on any campaign. */
export function applyApprovedTask(campaign: Campaign): AgentTask {
  return { skill: "apply", args: `campaign ${campaign.id}`, title: `Apply to approved jobs: ${campaign.query}`, campaignId: campaign.id };
}

export function extractResumeTask(resume: ResumeDetail, force: boolean): AgentTask {
  return {
    skill: "extract-resume",
    args: force ? `${resume.id} --force` : resume.id,
    title: `Read CV: ${resume.label}`,
    resumeId: resume.id,
  };
}

export function reviewResumeTask(resume: ResumeDetail): AgentTask {
  return { skill: "review-resume", args: resume.id, title: `Suggest improvements: ${resume.label}`, resumeId: resume.id };
}

export function coverLetterTask(input: { jobUrl?: string; jobText?: string; company?: string }): AgentTask {
  const args = [input.jobUrl ? `Job posting: ${input.jobUrl}` : "", input.jobText ? `Job description:\n${input.jobText}` : ""]
    .filter(Boolean)
    .join("\n\n");
  return { skill: "cover-letter", args: `${args}\n\nsource: manual`, title: `Cover letter${input.company ? `: ${input.company}` : ""}` };
}
