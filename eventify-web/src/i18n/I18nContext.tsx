import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";

export type Locale = "en" | "fr" | "nl";

const STORAGE_KEY = "eventium_locale";

const FALLBACK_LOCALE: Locale = "en";

export const LOCALE_META: Record<Locale, { flag: string; label: string }> = {
  en: { flag: "🇬🇧", label: "English" },
  fr: { flag: "🇫🇷", label: "Français" },
  nl: { flag: "🇧🇪", label: "Nederlands" },
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
