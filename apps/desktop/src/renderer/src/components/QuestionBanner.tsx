// When the agent can't continue without the user — a sign-in, a code, a CAPTCHA, a question only
// they can answer — it shows here, above every page, until it's answered or skipped.
import { useEffect, useState } from "react";
import type { Question } from "../../../shared/types";
import { call, useRpc } from "../api";
import { Button, Checkbox, useAction } from "./ui";

const KIND_LABEL: Record<string, string> = {
  signin: "Sign-in needed",
  verification: "Verification code needed",
  captcha: "Check needed in the browser",
  question: "The agent has a question",
  choice: "The agent has a question",
  salary: "Salary needed",
  review: "Look this over",
};

export function QuestionBanner() {
  const pending = useRpc("questions.list", ["pending"], ["questions"]);
  // Oldest first: that's the one the agent has waited on longest.
  const questions = [...(pending.data ?? [])].reverse();
  const question = questions[0];
  if (!question) return null;
  return (
    <section className="question" aria-label="The agent needs you">
      <QuestionCard key={question.id} question={question} remaining={questions.length - 1} />
    </section>
  );
}

function QuestionCard({ question, remaining }: { question: Question; remaining: number }) {
  const { busy, run } = useAction();
  const [answer, setAnswer] = useState("");
  const [remember, setRemember] = useState(true);
  useEffect(() => setAnswer(""), [question.id]);

  const send = (value: string) =>
    run("answer", () => call("questions.answer", question.id, value, remember && !!question.answerKey), "Sent to the agent");
  const skip = () => run("skip", () => call("questions.dismiss", question.id), "Skipped. The agent will move on.");

  const inBrowser = question.kind === "signin" || question.kind === "captcha";
  const choices = question.kind === "choice" && question.options.length > 0;
  const review = question.kind === "review";
  // Everything else (a question, a salary, a code, a choice that came without options) is typed.
  const typed = !inBrowser && !choices && !review;

  return (
    <div className="question-inner">
      <div>
        <p className="question-kind">{KIND_LABEL[question.kind] ?? "The agent needs you"}</p>
        <p className="question-text">{question.question}</p>
        {question.context ? <p className="question-context">{question.context}</p> : null}
        {inBrowser ? (
          <p className="question-context">Use the browser window the agent opened, then press Done here.</p>
        ) : null}
        {remaining > 0 ? <p className="question-more">{remaining} more after this one.</p> : null}
      </div>

      <form
        className="question-form"
        onSubmit={(event) => {
          event.preventDefault();
          if (typed && answer.trim()) void send(answer.trim());
        }}
      >
        {typed ? (
          <>
            <label className="sr-only" htmlFor={`answer-${question.id}`}>
              Your answer
            </label>
            <input
              id={`answer-${question.id}`}
              className="input"
              value={answer}
              autoComplete={question.kind === "verification" ? "one-time-code" : "off"}
              placeholder={question.kind === "verification" ? "Code" : "Your answer"}
              onChange={(event) => setAnswer(event.target.value)}
            />
            <Button type="submit" variant="primary" busy={busy === "answer"} disabled={!answer.trim()}>
              Send
            </Button>
            {question.kind === "verification" ? (
              <Button busy={busy === "answer"} onClick={() => send("Done")}>
                I entered it myself
              </Button>
            ) : null}
          </>
        ) : null}

        {choices
          ? question.options.map((option) => (
              <Button key={option} variant="secondary" busy={busy === "answer"} onClick={() => send(option)}>
                {option}
              </Button>
            ))
          : null}

        {inBrowser ? (
          <Button variant="primary" busy={busy === "answer"} onClick={() => send("Done")}>
            Done
          </Button>
        ) : null}

        {review ? (
          <Button variant="primary" busy={busy === "answer"} onClick={() => send("Approved")}>
            Looks right
          </Button>
        ) : null}

        <Button variant="ghost" busy={busy === "skip"} onClick={skip}>
          {review ? "Don't send" : "Skip"}
        </Button>

        {question.answerKey && (typed || choices) ? (
          <div className="question-remember">
            <Checkbox label="Use this answer on future forms" checked={remember} onChange={setRemember} />
          </div>
        ) : null}
      </form>
    </div>
  );
}
