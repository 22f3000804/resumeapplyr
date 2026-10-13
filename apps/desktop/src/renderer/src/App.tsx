import { useEffect, useRef } from "react";
import { AgentProvider } from "./agent";
import { QuestionBanner } from "./components/QuestionBanner";
import { Rail } from "./components/Rail";
import { ConfirmProvider, Empty, ToastProvider } from "./components/ui";
import { AgentPage } from "./pages/Agent";
import { ApplicationsPage } from "./pages/Applications";
import { CampaignDetailPage } from "./pages/CampaignDetail";
import { CampaignsPage } from "./pages/Campaigns";
import { HomePage } from "./pages/Home";
import { ProfilePage } from "./pages/Profile";
import { ResumesPage } from "./pages/Resumes";
import { SettingsPage } from "./pages/Settings";
import { href, type Route, useRoute } from "./router";

export function App() {
  return (
    <ToastProvider>
      <ConfirmProvider>
        <AgentProvider>
          <Shell />
        </AgentProvider>
      </ConfirmProvider>
    </ToastProvider>
  );
}

function Shell() {
  const route = useRoute();
  const main = useRef<HTMLElement>(null);
  const path = route.join("/");

  // A new page starts at the top.
  useEffect(() => {
    main.current?.scrollTo({ top: 0 });
  }, [path]);

  return (
    <div className="app">
      <button type="button" className="skip-link" onClick={() => main.current?.focus()}>
        Skip to content
      </button>
      <Rail section={route[0] ?? "home"} />
      <div className="main-col">
        <QuestionBanner />
        <main className="main" id="main" ref={main} tabIndex={-1}>
          <Page route={route} />
        </main>
      </div>
    </div>
  );
}

function Page({ route }: { route: Route }) {
  const [section, id, sub] = route;
  switch (section) {
    case "home":
      return <HomePage />;
    case "campaigns":
      return id && id !== "new" ? <CampaignDetailPage id={id} /> : <CampaignsPage creating={id === "new"} />;
    case "applications":
      return <ApplicationsPage />;
    case "cvs":
      return <ResumesPage id={id} tab={sub} />;
    case "profile":
      return <ProfilePage />;
    case "agent":
      return <AgentPage runId={id} />;
    case "settings":
      return <SettingsPage />;
    default:
      return (
        <Empty
          title="There's nothing here"
          action={
            <a className="btn btn-secondary" href={href("home")}>
              Go to Home
            </a>
          }
        />
      );
  }
}
