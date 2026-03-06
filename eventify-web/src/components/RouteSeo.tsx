import { useLocation } from "react-router-dom";
import { useSeo } from "../seo/useSeo";

function buildRouteSeo(pathname: string) {
  if (pathname === "/") {
    return {
      title: "Eventium | Discover Local Concerts & Events",
      description:
        "Discover concerts and events near you with smart filters, social insights, and personalized recommendations.",
      canonicalPath: "/",
    };
  }

  if (pathname.startsWith("/events/")) {
    return {
      title: "Event Details | Eventium",
      description:
        "View concert details, venue info, distance, social activity, and save events to your calendar.",
      canonicalPath: pathname,
      type: "article" as const,
    };
  }

  if (pathname === "/my-events") {
    return {
      title: "My Events | Eventium",
      description: "Create, edit, and manage your organizer events on Eventium.",
      canonicalPath: pathname,
      noindex: true,
    };
  }

  if (pathname === "/login") {
    return {
      title: "Login | Eventium",
      description: "Login to access your Eventium account and personalized event features.",
      canonicalPath: pathname,
      noindex: true,
    };
  }

  if (pathname === "/register") {
    return {
      title: "Sign Up | Eventium",
      description: "Create your Eventium account to save events and get personalized recommendations.",
      canonicalPath: pathname,
      noindex: true,
    };
  }

  if (pathname === "/privacy") {
    return {
      title: "Privacy Policy | Eventium",
      description: "Read how Eventium handles personal data and GDPR-related privacy rights.",
      canonicalPath: pathname,
    };
  }

  if (pathname === "/terms") {
    return {
      title: "Terms of Service | Eventium",
      description: "Review Eventium terms, usage rules, and legal information.",
      canonicalPath: pathname,
    };
  }

  if (pathname === "/cookies") {
    return {
      title: "Cookies & Local Storage | Eventium",
      description: "Understand how Eventium uses cookies and browser local storage.",
      canonicalPath: pathname,
    };
  }

  if (pathname === "/legal") {
    return {
      title: "Legal Notice | Eventium",
      description: "Legal notice and mandatory project information for Eventium.",
      canonicalPath: pathname,
    };
  }

  if (pathname === "/admin" || pathname.startsWith("/account")) {
    return {
      title: "Account | Eventium",
      description: "Manage your account settings on Eventium.",
      canonicalPath: pathname,
      noindex: true,
    };
  }

  return {
    title: "Eventium",
    description: "Discover local events and concerts on Eventium.",
    canonicalPath: pathname,
  };
}

export default function RouteSeo() {
  const { pathname } = useLocation();
  const seo = buildRouteSeo(pathname);
  useSeo(seo);
  return null;
}

