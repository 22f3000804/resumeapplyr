import type { ApplicationStatus } from "../../../core/schemas/application";
import type { CampaignJobStatus, CampaignStatus } from "../../../core/schemas/campaign";
import type { RunStatus } from "../../../shared/types";
import { APPLICATION_STATUS_LABEL, CAMPAIGN_STATUS_LABEL, JOB_STATUS_LABEL, RUN_STATUS_LABEL } from "../format";
import { Tag, type Tone } from "./ui";

// Tones carry meaning: accent = waiting on you, ink = happening now, outline = cleared to go,
// neutral = done, error = failed, quiet = set aside.

const JOB_TONE: Record<CampaignJobStatus, Tone> = {
  queued: "quiet",
  pending: "accent",
  approved: "outline",
  applying: "ink",
  applied: "neutral",
  failed: "error",
  skipped: "quiet",
  needs_user: "accent",
};

const CAMPAIGN_TONE: Record<CampaignStatus, Tone> = {
  in_progress: "outline",
  paused: "quiet",
  completed: "neutral",
  failed: "error",
};

const APPLICATION_TONE: Record<ApplicationStatus, Tone> = {
  applied: "neutral",
  screening: "outline",
  interviewing: "accent",
  offer: "ink",
  rejected: "quiet",
  withdrawn: "quiet",
};

const RUN_TONE: Record<RunStatus, Tone> = {
  running: "ink",
  succeeded: "neutral",
  failed: "error",
  stopped: "quiet",
};

export const JobStatusTag = ({ status }: { status: CampaignJobStatus }) => (
  <Tag tone={JOB_TONE[status]}>{JOB_STATUS_LABEL[status]}</Tag>
);

export const CampaignStatusTag = ({ status }: { status: CampaignStatus }) => (
  <Tag tone={CAMPAIGN_TONE[status]}>{CAMPAIGN_STATUS_LABEL[status]}</Tag>
);

export const ApplicationStatusTag = ({ status }: { status: ApplicationStatus }) => (
  <Tag tone={APPLICATION_TONE[status]}>{APPLICATION_STATUS_LABEL[status]}</Tag>
);

export const RunStatusTag = ({ status }: { status: RunStatus }) => <Tag tone={RUN_TONE[status]}>{RUN_STATUS_LABEL[status]}</Tag>;
