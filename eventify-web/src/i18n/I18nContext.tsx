import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "en" | "fr" | "nl";

const STORAGE_KEY = "eventium_locale";

const FALLBACK_LOCALE: Locale = "en";

export const LOCALE_META: Record<Locale, { flag: Locale; label: string }> = {
  en: { flag: "en", label: "English" },
  fr: { flag: "fr", label: "Français" },
  nl: { flag: "nl", label: "Nederlands" },
};

const messages = {
  en: {
    "common.close": "Close",
    "nav.searchPlaceholder": "Search artists, places...",
    "nav.search": "Search",
    "nav.suggestions": "Suggestions",
    "nav.clearHistory": "Clear history",
    "nav.recent": "Recent",
    "nav.suggestion": "Suggestion",
    "nav.installApp": "Install app",
    "nav.login": "Login",
    "nav.signup": "Sign up",
    "nav.notifications": "Notifications",
    "nav.unread": "unread",
    "nav.markAllRead": "Mark all read",
    "nav.noNotifications": "No notifications.",
    "nav.account": "Account",
    "nav.myEvents": "My Events",
    "nav.adminDashboard": "Admin Dashboard",
    "nav.settings": "Settings",
    "nav.logout": "Logout",
    "nav.language": "Language",
    "footer.tagline":
      "Hyper-local event discovery for your next night out — fast filters, social proof, and smart recommendations.",
    "footer.location": "Brussels • Belgium",
    "footer.studentProject": "Student project",
    "footer.explore": "Explore",
    "footer.discover": "Discover",
    "footer.myEvents": "My events",
    "footer.account": "Account",
    "footer.login": "Login",
    "footer.signup": "Sign up",
    "footer.admin": "Admin",
    "footer.legal": "Legal",
    "footer.privacy": "Privacy (GDPR)",
    "footer.terms": "Terms",
    "footer.cookies": "Cookies",
    "footer.legalNotice": "Legal notice",
    "footer.contact": "Contact",
    "footer.fineprint":
      "Event data and images may come from public sources and remain the property of their respective owners. If you want an event or image removed/updated, contact us.",
    "auth.login": "Login",
    "auth.register": "Register",
    "auth.email": "Email",
    "auth.password": "Password",
    "auth.confirmPassword": "Confirm password",
    "auth.name": "Name",
    "auth.placeholderEmail": "you@email.com",
    "auth.placeholderPassword": "••••••••",
    "auth.placeholderName": "Your name",
    "auth.noAccount": "No account yet?",
    "auth.createOne": "Create one",
    "auth.haveAccount": "Already have an account?",
    "auth.loginAction": "Login",
    "auth.loginLoading": "Logging in…",
    "auth.registerAction": "Create account",
    "auth.registerLoading": "Creating…",
    "auth.passwordMin": "Password must be at least 8 characters.",
    "auth.error.validEmail": "Please enter a valid email.",
    "auth.error.passwordRequired": "Please enter your password.",
    "auth.error.loginFailed": "Login failed.",
    "auth.error.passwordMin": "Password must be at least 8 characters.",
    "auth.error.passwordMatch": "Passwords do not match.",
    "auth.error.registerFailed": "Register failed.",
    "auth.validation.good": "Looks good",
    "auth.validation.bad": "Not valid yet",
    "loading.aria": "Loading",
    "loading.title": "Preparing your events",
    "loading.hint": "Loading local scene, maps, and recommendations.",
    "hero.title": "Your local scene awaits.",
    "hero.subtitle": "Discover all the concerts around you — in one place.",
    "legal.privacy.title": "Privacy Policy",
    "legal.privacy.lead":
      "This page explains what data Eventium collects, why we collect it, and your rights under GDPR.",
    "legal.terms.title": "Terms of Service",
    "legal.terms.lead": "Basic rules for using Eventium. This is a student project and provided “as is”.",
    "legal.cookies.title": "Cookies & Local Storage",
    "legal.cookies.lead": "Eventium mainly uses browser storage to keep you logged in and save preferences.",
    "legal.notice.title": "Legal Notice",
    "legal.notice.lead": "Mandatory information + disclaimer for this student project.",
    "dash.hero.subtitle": "Discover concerts around you — fast, local, personal.",
    "dash.search.style": "Search a style…",
    "dash.search.city": "Search a city…",
    "dash.distance": "Distance (Km)",
    "dash.loading.events": "Loading events…",
    "dash.event.one": "event found",
    "dash.event.many": "events found",
    "dash.retry": "Retry",
    "dash.retryNow": "Retry now",
    "dash.offline.hint": "You're offline. Open your recently viewed events.",
    "dash.recommended.title": "Recommended for you",
    "dash.recommended.basedOn": "Based on:",
    "dash.personalized": "Personalized",
    "dash.trending.hint": "Hot events around you",
    "dash.noFilters": "No filters",
    "dash.noTrending": "No trending events for this filter.",
    "dash.all.title": "All events",
    "dash.all.hint": "Everything that matches your filters",
    "dash.resultsView": "Results view",
    "dash.list": "List",
    "dash.map": "Map",
    "dash.split": "Split",
    "dash.hoverHint": "Hover a dot to see the event name • Click a dot to open the details",
    "dash.loading.map": "Loading events on the map…",
    "dash.noEvents": "No events match your filters.",
  },
  fr: {
    "common.close": "Fermer",
    "nav.searchPlaceholder": "Rechercher artistes, lieux...",
    "nav.search": "Rechercher",
    "nav.suggestions": "Suggestions",
    "nav.clearHistory": "Effacer l'historique",
    "nav.recent": "Récent",
    "nav.suggestion": "Suggestion",
    "nav.installApp": "Installer l'app",
    "nav.login": "Connexion",
    "nav.signup": "S'inscrire",
    "nav.notifications": "Notifications",
    "nav.unread": "non lues",
    "nav.markAllRead": "Tout marquer comme lu",
    "nav.noNotifications": "Aucune notification.",
    "nav.account": "Compte",
    "nav.myEvents": "Mes événements",
    "nav.adminDashboard": "Dashboard admin",
    "nav.settings": "Paramètres",
    "nav.logout": "Déconnexion",
    "nav.language": "Langue",
    "footer.tagline":
      "Découverte d'événements hyper-locaux pour votre prochaine soirée — filtres rapides, preuve sociale et recommandations intelligentes.",
    "footer.location": "Bruxelles • Belgique",
    "footer.studentProject": "Projet étudiant",
    "footer.explore": "Explorer",
    "footer.discover": "Découvrir",
    "footer.myEvents": "Mes événements",
    "footer.account": "Compte",
    "footer.login": "Connexion",
    "footer.signup": "S'inscrire",
    "footer.admin": "Admin",
    "footer.legal": "Légal",
    "footer.privacy": "Confidentialité (RGPD)",
    "footer.terms": "Conditions",
    "footer.cookies": "Cookies",
    "footer.legalNotice": "Mentions légales",
    "footer.contact": "Contact",
    "footer.fineprint":
      "Les données et images d'événements peuvent provenir de sources publiques et restent la propriété de leurs détenteurs respectifs. Si vous souhaitez supprimer/mettre à jour un événement ou une image, contactez-nous.",
    "auth.login": "Connexion",
    "auth.register": "Inscription",
    "auth.email": "Email",
    "auth.password": "Mot de passe",
    "auth.confirmPassword": "Confirmer le mot de passe",
    "auth.name": "Nom",
    "auth.placeholderEmail": "vous@email.com",
    "auth.placeholderPassword": "••••••••",
    "auth.placeholderName": "Votre nom",
    "auth.noAccount": "Pas encore de compte ?",
    "auth.createOne": "Créer un compte",
    "auth.haveAccount": "Vous avez déjà un compte ?",
    "auth.loginAction": "Connexion",
    "auth.loginLoading": "Connexion en cours…",
    "auth.registerAction": "Créer un compte",
    "auth.registerLoading": "Création…",
    "auth.passwordMin": "Le mot de passe doit contenir au moins 8 caractères.",
    "auth.error.validEmail": "Veuillez entrer un email valide.",
    "auth.error.passwordRequired": "Veuillez entrer votre mot de passe.",
    "auth.error.loginFailed": "Échec de connexion.",
    "auth.error.passwordMin": "Le mot de passe doit contenir au moins 8 caractères.",
    "auth.error.passwordMatch": "Les mots de passe ne correspondent pas.",
    "auth.error.registerFailed": "Échec de l'inscription.",
    "auth.validation.good": "Correct",
    "auth.validation.bad": "Pas encore valide",
    "loading.aria": "Chargement",
    "loading.title": "Préparation de vos événements",
    "loading.hint": "Chargement de la scène locale, des cartes et des recommandations.",
    "hero.title": "Votre scène locale vous attend.",
    "hero.subtitle": "Découvrez tous les concerts autour de vous — au même endroit.",
    "legal.privacy.title": "Politique de confidentialité",
    "legal.privacy.lead":
      "Cette page explique quelles données Eventium collecte, pourquoi nous les collectons et vos droits RGPD.",
    "legal.terms.title": "Conditions d'utilisation",
    "legal.terms.lead":
      "Règles de base pour utiliser Eventium. Ceci est un projet étudiant, fourni « tel quel ».",
    "legal.cookies.title": "Cookies et stockage local",
    "legal.cookies.lead":
      "Eventium utilise principalement le stockage du navigateur pour vous garder connecté et enregistrer vos préférences.",
    "legal.notice.title": "Mentions légales",
    "legal.notice.lead": "Informations obligatoires + clause de non-responsabilité pour ce projet étudiant.",
    "dash.hero.subtitle": "Découvrez les concerts autour de vous — rapide, local, personnel.",
    "dash.search.style": "Rechercher un style…",
    "dash.search.city": "Rechercher une ville…",
    "dash.distance": "Distance (Km)",
    "dash.loading.events": "Chargement des événements…",
    "dash.event.one": "événement trouvé",
    "dash.event.many": "événements trouvés",
    "dash.retry": "Réessayer",
    "dash.retryNow": "Réessayer maintenant",
    "dash.offline.hint": "Vous êtes hors ligne. Ouvrez vos événements récemment consultés.",
    "dash.recommended.title": "Recommandés pour vous",
    "dash.recommended.basedOn": "Basé sur :",
    "dash.personalized": "Personnalisé",
    "dash.trending.hint": "Événements populaires autour de vous",
    "dash.noFilters": "Aucun filtre",
    "dash.noTrending": "Aucun événement tendance pour ce filtre.",
    "dash.all.title": "Tous les événements",
    "dash.all.hint": "Tout ce qui correspond à vos filtres",
    "dash.resultsView": "Vue des résultats",
    "dash.list": "Liste",
    "dash.map": "Carte",
    "dash.split": "Split",
    "dash.hoverHint": "Survolez un point pour voir le nom • Cliquez pour ouvrir le détail",
    "dash.loading.map": "Chargement des événements sur la carte…",
    "dash.noEvents": "Aucun événement ne correspond à vos filtres.",
  },
  nl: {
    "common.close": "Sluiten",
    "nav.searchPlaceholder": "Zoek artiesten, locaties...",
    "nav.search": "Zoeken",
    "nav.suggestions": "Suggesties",
    "nav.clearHistory": "Geschiedenis wissen",
    "nav.recent": "Recent",
    "nav.suggestion": "Suggestie",
    "nav.installApp": "App installeren",
    "nav.login": "Inloggen",
    "nav.signup": "Registreren",
    "nav.notifications": "Meldingen",
    "nav.unread": "ongelezen",
    "nav.markAllRead": "Alles als gelezen markeren",
    "nav.noNotifications": "Geen meldingen.",
    "nav.account": "Account",
    "nav.myEvents": "Mijn events",
    "nav.adminDashboard": "Admin dashboard",
    "nav.settings": "Instellingen",
    "nav.logout": "Uitloggen",
    "nav.language": "Taal",
    "footer.tagline":
      "Hyperlokale event discovery voor je volgende avondje uit — snelle filters, social proof en slimme aanbevelingen.",
    "footer.location": "Brussel • België",
    "footer.studentProject": "Studentenproject",
    "footer.explore": "Ontdekken",
    "footer.discover": "Discover",
    "footer.myEvents": "Mijn events",
    "footer.account": "Account",
    "footer.login": "Inloggen",
    "footer.signup": "Registreren",
    "footer.admin": "Admin",
    "footer.legal": "Juridisch",
    "footer.privacy": "Privacy (GDPR)",
    "footer.terms": "Voorwaarden",
    "footer.cookies": "Cookies",
    "footer.legalNotice": "Juridische kennisgeving",
    "footer.contact": "Contact",
    "footer.fineprint":
      "Eventdata en afbeeldingen kunnen afkomstig zijn van publieke bronnen en blijven eigendom van hun respectieve eigenaars. Wil je een event of afbeelding verwijderen/updaten, neem contact op.",
    "auth.login": "Inloggen",
    "auth.register": "Registreren",
    "auth.email": "E-mail",
    "auth.password": "Wachtwoord",
    "auth.confirmPassword": "Bevestig wachtwoord",
    "auth.name": "Naam",
    "auth.placeholderEmail": "jij@email.com",
    "auth.placeholderPassword": "••••••••",
    "auth.placeholderName": "Jouw naam",
    "auth.noAccount": "Nog geen account?",
    "auth.createOne": "Maak er een",
    "auth.haveAccount": "Heb je al een account?",
    "auth.loginAction": "Inloggen",
    "auth.loginLoading": "Bezig met inloggen…",
    "auth.registerAction": "Account maken",
    "auth.registerLoading": "Bezig met maken…",
    "auth.passwordMin": "Wachtwoord moet minstens 8 tekens hebben.",
    "auth.error.validEmail": "Voer een geldig e-mailadres in.",
    "auth.error.passwordRequired": "Voer je wachtwoord in.",
    "auth.error.loginFailed": "Inloggen mislukt.",
    "auth.error.passwordMin": "Wachtwoord moet minstens 8 tekens hebben.",
    "auth.error.passwordMatch": "Wachtwoorden komen niet overeen.",
    "auth.error.registerFailed": "Registreren mislukt.",
    "auth.validation.good": "Ziet er goed uit",
    "auth.validation.bad": "Nog niet geldig",
    "loading.aria": "Laden",
    "loading.title": "Je events voorbereiden",
    "loading.hint": "Lokale scene, kaarten en aanbevelingen worden geladen.",
    "hero.title": "Jouw lokale scene wacht.",
    "hero.subtitle": "Ontdek alle concerten rondom jou — op één plek.",
    "legal.privacy.title": "Privacybeleid",
    "legal.privacy.lead":
      "Deze pagina legt uit welke data Eventium verzamelt, waarom we die verzamelen en je rechten onder GDPR.",
    "legal.terms.title": "Gebruiksvoorwaarden",
    "legal.terms.lead":
      "Basisregels voor het gebruik van Eventium. Dit is een studentenproject en wordt aangeboden “as is”.",
    "legal.cookies.title": "Cookies & lokale opslag",
    "legal.cookies.lead":
      "Eventium gebruikt vooral browseropslag om je ingelogd te houden en voorkeuren op te slaan.",
    "legal.notice.title": "Juridische kennisgeving",
    "legal.notice.lead": "Verplichte info + disclaimer voor dit studentenproject.",
    "dash.hero.subtitle": "Ontdek concerten rond jou — snel, lokaal, persoonlijk.",
    "dash.search.style": "Zoek een stijl…",
    "dash.search.city": "Zoek een stad…",
    "dash.distance": "Afstand (Km)",
    "dash.loading.events": "Events laden…",
    "dash.event.one": "event gevonden",
    "dash.event.many": "events gevonden",
    "dash.retry": "Opnieuw",
    "dash.retryNow": "Nu opnieuw",
    "dash.offline.hint": "Je bent offline. Open je recent bekeken events.",
    "dash.recommended.title": "Aanbevolen voor jou",
    "dash.recommended.basedOn": "Gebaseerd op:",
    "dash.personalized": "Persoonlijk",
    "dash.trending.hint": "Populaire events rond jou",
    "dash.noFilters": "Geen filters",
    "dash.noTrending": "Geen trending events voor deze filter.",
    "dash.all.title": "Alle events",
    "dash.all.hint": "Alles dat past bij je filters",
    "dash.resultsView": "Resultaatweergave",
    "dash.list": "Lijst",
    "dash.map": "Kaart",
    "dash.split": "Split",
    "dash.hoverHint": "Hover op een punt voor de naam • Klik om details te openen",
    "dash.loading.map": "Events op de kaart laden…",
    "dash.noEvents": "Geen events die passen bij je filters.",
  },
} as const;

type MessageKey = keyof (typeof messages)["en"];

type I18nContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: MessageKey) => string;
};

const I18nContext = createContext<I18nContextValue | null>(null);

function resolveInitialLocale(): Locale {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === "en" || raw === "fr" || raw === "nl") return raw;
  } catch {
    // ignore
  }
  const lang = (navigator.language || "").toLowerCase();
  if (lang.startsWith("fr")) return "fr";
  if (lang.startsWith("nl")) return "nl";
  return FALLBACK_LOCALE;
}

export function I18nProvider({ children }: { children: ReactNode }) {
  const [locale, setLocale] = useState<Locale>(() => resolveInitialLocale());

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, locale);
    } catch {
      // ignore
    }
    document.documentElement.lang = locale;
  }, [locale]);

  const value = useMemo<I18nContextValue>(() => {
    const t = (key: MessageKey) => messages[locale][key] || messages.en[key] || key;
    return { locale, setLocale, t };
  }, [locale]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n() {
  const ctx = useContext(I18nContext);
  if (!ctx) throw new Error("useI18n must be used inside <I18nProvider>");
  return ctx;
}
