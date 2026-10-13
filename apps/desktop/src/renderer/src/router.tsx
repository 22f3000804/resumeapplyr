// Hash routes (#/campaigns/<id>): the window loads from a file, so there is no server to route.
import { type AnchorHTMLAttributes, useEffect, useState } from "react";

export type Route = string[];

function parse(hash: string): Route {
  const path = hash.replace(/^#\/?/, "").split("?")[0] ?? "";
  const parts = path.split("/").filter(Boolean).map(decodeURIComponent);
  return parts.length ? parts : ["home"];
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parse(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parse(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function href(...parts: string[]): string {
  return `#/${parts.map(encodeURIComponent).join("/")}`;
}

export function navigate(...parts: string[]): void {
  window.location.hash = href(...parts).slice(1);
}

interface LinkProps extends Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> {
  to: string[];
}

export function Link({ to, ...rest }: LinkProps) {
  return <a {...rest} href={href(...to)} />;
}
