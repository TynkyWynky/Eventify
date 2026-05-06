import { useLocation } from "react-router-dom";
import { useSeo } from "../seo/useSeo";

function buildRouteSeo(pathname: string) {
  if (pathname === "/") {
    return {
      title: "Eventium Belgium | Discover Concerts, Nightlife & Local Events",
      description:
        "Eventium helps you discover concerts, nightlife, and local events in Brussels and across Belgium with smart filters and personalized recommendations.",
      canonicalPath: "/",
      locale: "en_BE",
    };
  }

  if (pathname.startsWith("/events/")) {
    return {
      title: "Event Details | Eventium",
      description:
        "View concert details, venue info, distance, social activity, and save events to your calendar.",
      canonicalPath: pathname,
      type: "article" as const,
      locale: "en_BE",
    };
  }

  if (pathname === "/my-events") {
    return {
      title: "My Events | Eventium",
      description: "Create, edit, and manage your organizer events on Eventium.",
      canonicalPath: pathname,
      noindex: true,
      locale: "en_BE",
    };
  }

  if (pathname === "/login") {
    return {
      title: "Login | Eventium",
      description: "Login to access your Eventium account and personalized event features.",
      canonicalPath: pathname,
      noindex: true,
      locale: "en_BE",
    };
  }

  if (pathname === "/register") {
    return {
      title: "Sign Up | Eventium",
      description: "Create your Eventium account to save events and get personalized recommendations.",
      canonicalPath: pathname,
      noindex: true,
      locale: "en_BE",
    };
  }

  if (pathname === "/forgot-password" || pathname === "/reset-password") {
    return {
      title: "Reset Password | Eventium",
      description: "Request a secure password reset link and update your Eventium password.",
      canonicalPath: pathname,
      noindex: true,
      locale: "en_BE",
    };
  }

  if (pathname === "/privacy") {
    return {
      title: "Privacy Policy | Eventium",
      description: "Read how Eventium handles personal data and GDPR-related privacy rights.",
      canonicalPath: pathname,
      locale: "en_BE",
    };
  }

  if (pathname === "/terms") {
    return {
      title: "Terms of Service | Eventium",
      description: "Review Eventium terms, usage rules, and legal information.",
      canonicalPath: pathname,
      locale: "en_BE",
    };
  }

  if (pathname === "/cookies") {
    return {
      title: "Cookies & Local Storage | Eventium",
      description: "Understand how Eventium uses cookies and browser local storage.",
      canonicalPath: pathname,
      locale: "en_BE",
    };
  }

  if (pathname === "/legal") {
    return {
      title: "Legal Notice | Eventium",
      description: "Legal notice and project information for Eventium, the Belgian local event discovery platform.",
      canonicalPath: pathname,
      locale: "en_BE",
    };
  }

  if (pathname === "/admin" || pathname.startsWith("/account")) {
    return {
      title: "Account | Eventium",
      description: "Manage your account settings on Eventium.",
      canonicalPath: pathname,
      noindex: true,
      locale: "en_BE",
    };
  }

  return {
    title: "Eventium Belgium",
    description: "Discover local events, concerts, and nightlife on Eventium in Belgium.",
    canonicalPath: pathname,
    locale: "en_BE",
  };
}

export default function RouteSeo() {
  const { pathname } = useLocation();
  const seo = buildRouteSeo(pathname);
  useSeo(seo);
  return null;
}
