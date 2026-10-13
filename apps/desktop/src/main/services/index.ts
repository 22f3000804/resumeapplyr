import { ApplicationService } from "./applications";
import { BoardService } from "./boards";
import { CampaignService } from "./campaigns";
import type { ServiceContext } from "./context";
import { AnswerService, CoverLetterService, QuestionService, ScoringService } from "./misc";
import { ProfileService, SettingsService } from "./profile";
import { ResumeService } from "./resumes";
import { RunService } from "./runs";

export function createServices(ctx: ServiceContext) {
  const settings = new SettingsService(ctx);
  const profile = new ProfileService(ctx);
  const resumes = new ResumeService(ctx, profile, settings);
  const applications = new ApplicationService(ctx);
  const campaigns = new CampaignService(ctx, settings, resumes, applications);
  return {
    ctx,
    settings,
    profile,
    resumes,
    applications,
    campaigns,
    boards: new BoardService(ctx),
    scoring: new ScoringService(resumes, profile, settings),
    questions: new QuestionService(ctx),
    answers: new AnswerService(ctx),
    letters: new CoverLetterService(ctx, settings),
    runs: new RunService(ctx),
  };
}

export type Services = ReturnType<typeof createServices>;
