import type { Locale } from "@/lib/i18n";

/**
 * Transactional email copy, one dictionary per locale with English fallback.
 *
 * Only the four ready-to-ship languages belong here: `ar` is `pending` and
 * renders English until COMMIT B. Placeholders use `{name}`, `{link}` etc.
 * and are filled by `renderEmailCopy`.
 */

type EmailKey =
  | "welcome"
  | "emailVerify"
  | "passwordReset"
  | "signupAttemptNotice"
  | "trialStarted"
  | "trialEnding"
  | "paymentSuccess"
  | "paymentFailed"
  | "subscriptionCanceled"
  | "usageLimitReached";

type EmailCopy = { subject: string; html: string; text: string };

const en: Record<EmailKey, EmailCopy> = {
  welcome: {
    subject: "Welcome to AutoEco",
    html: "Hi {name},</p><p>Welcome to <strong>AutoEco</strong> — the financial operating system for your car. Add your vehicle, log fuel and expenses, and AutoEco works out what your car really costs per month and per kilometer.</p><p>Get started: <a href=\"{appUrl}/dashboard\">{appUrl}/dashboard</a></p>",
    text: "Welcome to AutoEco. Add your car and start tracking: {appUrl}/dashboard",
  },
  emailVerify: {
    subject: "Verify your AutoEco email",
    html: "Hi {name},</p><p>Please verify your email by clicking the link below:</p><p><a href=\"{link}\">{link}</a></p><p>This link expires in 24 hours.</p>",
    text: "Verify your email: {link} (expires in 24 hours)",
  },
  passwordReset: {
    subject: "Reset your AutoEco password",
    html: "Hi {name},</p><p>Use the link below to reset your password:</p><p><a href=\"{link}\">{link}</a></p><p>If you did not request this, you can ignore this email.</p>",
    text: "Reset your password: {link}",
  },
  signupAttemptNotice: {
    subject: "Someone tried to sign up with your email address",
    html: "Hi {name},</p><p>Someone tried to create an AutoEco account using this email address. No new account was created and nothing has changed.</p><p>If this was you, you can sign in as usual, or reset your password here: <a href=\"{appUrl}/forgot-password\">{appUrl}/forgot-password</a></p><p>If it was not you, no action is needed.</p>",
    text: "Someone tried to create an AutoEco account with this address. No account was created. If this was you: {appUrl}/forgot-password",
  },
  trialStarted: {
    subject: "Your AutoEco {days}-day free trial is active",
    html: "Hi {name},</p><p>Your free trial is now active. <a href=\"{appUrl}/dashboard\">Go to your dashboard</a> and add your first vehicle.</p>",
    text: "Your {days}-day free trial is active. Go to {appUrl}/dashboard",
  },
  trialEnding: {
    subject: "Your trial ends in {days} day(s)",
    html: "Hi {name},</p><p>Your trial ends in {days} day(s). <a href=\"{appUrl}/settings/billing\">Upgrade now</a> to keep multi-vehicle tracking, forecasts and Ask Your Car.</p>",
    text: "Trial ends in {days} day(s). Upgrade at {appUrl}/settings/billing",
  },
  paymentSuccess: {
    subject: "Payment successful — {planName} is active",
    html: "Hi {name},</p><p>Your payment was successful. The <strong>{planName}</strong> plan is now active.</p>",
    text: "Payment successful — {planName} is active.",
  },
  paymentFailed: {
    subject: "Payment failed — action required",
    html: "Hi {name},</p><p>We could not process your most recent payment. Please <a href=\"{appUrl}/settings/billing\">update your billing</a> to avoid interruption.</p>",
    text: "Payment failed. Update billing at {appUrl}/settings/billing",
  },
  subscriptionCanceled: {
    subject: "Your AutoEco subscription was canceled",
    html: "Hi {name},</p><p>Your subscription has been canceled. You will retain access until <strong>{endDate}</strong>.</p>",
    text: "Subscription canceled. Access until {endDate}.",
  },
  usageLimitReached: {
    subject: "You've reached your {label} limit",
    html: "Hi {name},</p><p>You've reached your current <strong>{label}</strong> limit. <a href=\"{appUrl}/settings/billing\">Upgrade your plan</a> to continue.</p>",
    text: "You've reached your {label} limit. Upgrade at {appUrl}/settings/billing",
  },
};

const fr: Record<EmailKey, EmailCopy> = {
  welcome: {
    subject: "Bienvenue sur AutoEco",
    html: "Bonjour {name},</p><p>Bienvenue sur <strong>AutoEco</strong> — le système d'exploitation financier de votre voiture. Ajoutez votre véhicule, enregistrez carburant et dépenses, et AutoEco calcule ce que votre voiture coûte vraiment par mois et par kilomètre.</p><p>Pour commencer : <a href=\"{appUrl}/dashboard\">{appUrl}/dashboard</a></p>",
    text: "Bienvenue sur AutoEco. Ajoutez votre voiture et commencez à suivre vos coûts : {appUrl}/dashboard",
  },
  emailVerify: {
    subject: "Vérifiez votre e-mail AutoEco",
    html: "Bonjour {name},</p><p>Merci de vérifier votre e-mail en cliquant sur le lien ci-dessous :</p><p><a href=\"{link}\">{link}</a></p><p>Ce lien expire dans 24 heures.</p>",
    text: "Vérifiez votre e-mail : {link} (expire dans 24 heures)",
  },
  passwordReset: {
    subject: "Réinitialisez votre mot de passe AutoEco",
    html: "Bonjour {name},</p><p>Utilisez le lien ci-dessous pour réinitialiser votre mot de passe :</p><p><a href=\"{link}\">{link}</a></p><p>Si vous n'avez pas demandé cette réinitialisation, vous pouvez ignorer cet e-mail.</p>",
    text: "Réinitialisez votre mot de passe : {link}",
  },
  signupAttemptNotice: {
    subject: "Une tentative d'inscription a été faite avec votre adresse e-mail",
    html: "Bonjour {name},</p><p>Quelqu'un a tenté de créer un compte AutoEco avec cette adresse e-mail. Aucun nouveau compte n'a été créé et rien n'a changé.</p><p>S'il s'agissait de vous, connectez-vous comme d'habitude ou réinitialisez votre mot de passe ici : <a href=\"{appUrl}/forgot-password\">{appUrl}/forgot-password</a></p><p>Sinon, aucune action n'est nécessaire.</p>",
    text: "Quelqu'un a tenté de créer un compte AutoEco avec cette adresse. Aucun compte n'a été créé. S'il s'agissait de vous : {appUrl}/forgot-password",
  },
  trialStarted: {
    subject: "Votre essai gratuit de {days} jours est actif",
    html: "Bonjour {name},</p><p>Votre essai gratuit est maintenant actif. <a href=\"{appUrl}/dashboard\">Accédez à votre tableau de bord</a> et ajoutez votre premier véhicule.</p>",
    text: "Votre essai gratuit de {days} jours est actif. Accédez à {appUrl}/dashboard",
  },
  trialEnding: {
    subject: "Votre essai se termine dans {days} jour(s)",
    html: "Bonjour {name},</p><p>Votre essai se termine dans {days} jour(s). <a href=\"{appUrl}/settings/billing\">Passez maintenant au plan payant</a> pour continuer à suivre plusieurs véhicules, les prévisions et Ask Your Car.</p>",
    text: "L'essai se termine dans {days} jour(s). Passez au plan payant : {appUrl}/settings/billing",
  },
  paymentSuccess: {
    subject: "Paiement réussi — {planName} est actif",
    html: "Bonjour {name},</p><p>Votre paiement a été accepté. L'offre <strong>{planName}</strong> est maintenant active.</p>",
    text: "Paiement réussi — {planName} est actif.",
  },
  paymentFailed: {
    subject: "Paiement échoué — action requise",
    html: "Bonjour {name},</p><p>Nous n'avons pas pu traiter votre dernier paiement. Merci de <a href=\"{appUrl}/settings/billing\">mettre à jour vos informations de facturation</a> pour éviter toute interruption.</p>",
    text: "Paiement échoué. Mettez à jour la facturation : {appUrl}/settings/billing",
  },
  subscriptionCanceled: {
    subject: "Votre abonnement AutoEco a été annulé",
    html: "Bonjour {name},</p><p>Votre abonnement a été annulé. Vous conserverez l'accès jusqu'au <strong>{endDate}</strong>.</p>",
    text: "Abonnement annulé. Accès jusqu'au {endDate}.",
  },
  usageLimitReached: {
    subject: "Vous avez atteint votre limite de {label}",
    html: "Bonjour {name},</p><p>Vous avez atteint votre limite actuelle de <strong>{label}</strong>. <a href=\"{appUrl}/settings/billing\">Passez au plan supérieur</a> pour continuer.</p>",
    text: "Vous avez atteint votre limite de {label}. Passez au plan supérieur : {appUrl}/settings/billing",
  },
};

const es: Record<EmailKey, EmailCopy> = {
  welcome: {
    subject: "Bienvenido a AutoEco",
    html: "Hola {name},</p><p>Bienvenido a <strong>AutoEco</strong> — el sistema operativo financiero de su coche. Añada su vehículo, registre combustible y gastos, y AutoEco calculará lo que su coche cuesta de verdad por mes y por kilómetro.</p><p>Para empezar: <a href=\"{appUrl}/dashboard\">{appUrl}/dashboard</a></p>",
    text: "Bienvenido a AutoEco. Añada su coche y empiece a registrar: {appUrl}/dashboard",
  },
  emailVerify: {
    subject: "Verifique su correo de AutoEco",
    html: "Hola {name},</p><p>Verifique su correo haciendo clic en el enlace siguiente:</p><p><a href=\"{link}\">{link}</a></p><p>Este enlace caduca en 24 horas.</p>",
    text: "Verifique su correo: {link} (caduca en 24 horas)",
  },
  passwordReset: {
    subject: "Restablezca su contraseña de AutoEco",
    html: "Hola {name},</p><p>Utilice el enlace siguiente para restablecer su contraseña:</p><p><a href=\"{link}\">{link}</a></p><p>Si no lo ha solicitado, puede ignorar este correo.</p>",
    text: "Restablezca su contraseña: {link}",
  },
  signupAttemptNotice: {
    subject: "Alguien intentó registrarse con su dirección de correo",
    html: "Hola {name},</p><p>Alguien intentó crear una cuenta de AutoEco con esta dirección de correo. No se creó ninguna cuenta nueva y nada ha cambiado.</p><p>Si fue usted, puede iniciar sesión con normalidad o restablecer su contraseña aquí: <a href=\"{appUrl}/forgot-password\">{appUrl}/forgot-password</a></p><p>Si no fue usted, no necesita hacer nada.</p>",
    text: "Alguien intentó crear una cuenta de AutoEco con esta dirección. No se creó ninguna cuenta. Si fue usted: {appUrl}/forgot-password",
  },
  trialStarted: {
    subject: "Su prueba gratuita de {days} días está activa",
    html: "Hola {name},</p><p>Su prueba gratuita ya está activa. <a href=\"{appUrl}/dashboard\">Vaya a su panel</a> y añada su primer vehículo.</p>",
    text: "Su prueba gratuita de {days} días está activa. Vaya a {appUrl}/dashboard",
  },
  trialEnding: {
    subject: "Su prueba termina en {days} día(s)",
    html: "Hola {name},</p><p>Su prueba termina en {days} día(s). <a href=\"{appUrl}/settings/billing\">Mejore ahora</a> para conservar el seguimiento de varios vehículos, las previsiones y Ask Your Car.</p>",
    text: "La prueba termina en {days} día(s). Mejore en {appUrl}/settings/billing",
  },
  paymentSuccess: {
    subject: "Pago correcto — {planName} está activo",
    html: "Hola {name},</p><p>Su pago se ha procesado correctamente. El plan <strong>{planName}</strong> ya está activo.</p>",
    text: "Pago correcto — {planName} está activo.",
  },
  paymentFailed: {
    subject: "Pago rechazado — se requiere una acción",
    html: "Hola {name},</p><p>No pudimos procesar su último pago. <a href=\"{appUrl}/settings/billing\">Actualice su facturación</a> para evitar interrupciones.</p>",
    text: "Pago rechazado. Actualice la facturación en {appUrl}/settings/billing",
  },
  subscriptionCanceled: {
    subject: "Su suscripción a AutoEco se ha cancelado",
    html: "Hola {name},</p><p>Su suscripción se ha cancelado. Conservará el acceso hasta el <strong>{endDate}</strong>.</p>",
    text: "Suscripción cancelada. Acceso hasta el {endDate}.",
  },
  usageLimitReached: {
    subject: "Ha alcanzado su límite de {label}",
    html: "Hola {name},</p><p>Ha alcanzado su límite actual de <strong>{label}</strong>. <a href=\"{appUrl}/settings/billing\">Mejore su plan</a> para continuar.</p>",
    text: "Ha alcanzado su límite de {label}. Mejore en {appUrl}/settings/billing",
  },
};

const ptBR: Record<EmailKey, EmailCopy> = {
  welcome: {
    subject: "Bem-vindo ao AutoEco",
    html: "Olá {name},</p><p>Bem-vindo ao <strong>AutoEco</strong> — o sistema operacional financeiro do seu carro. Adicione seu veículo, registre combustível e despesas, e o AutoEco calcula o que o seu carro realmente custa por mês e por quilômetro.</p><p>Para começar: <a href=\"{appUrl}/dashboard\">{appUrl}/dashboard</a></p>",
    text: "Bem-vindo ao AutoEco. Adicione seu carro e comece a registrar: {appUrl}/dashboard",
  },
  emailVerify: {
    subject: "Verifique seu e-mail do AutoEco",
    html: "Olá {name},</p><p>Verifique seu e-mail clicando no link abaixo:</p><p><a href=\"{link}\">{link}</a></p><p>Este link expira em 24 horas.</p>",
    text: "Verifique seu e-mail: {link} (expira em 24 horas)",
  },
  passwordReset: {
    subject: "Redefina sua senha do AutoEco",
    html: "Olá {name},</p><p>Use o link abaixo para redefinir sua senha:</p><p><a href=\"{link}\">{link}</a></p><p>Se você não solicitou isso, pode ignorar este e-mail.</p>",
    text: "Redefina sua senha: {link}",
  },
  signupAttemptNotice: {
    subject: "Alguém tentou se cadastrar com seu endereço de e-mail",
    html: "Olá {name},</p><p>Alguém tentou criar uma conta no AutoEco com este endereço de e-mail. Nenhuma conta nova foi criada e nada mudou.</p><p>Se foi você, pode entrar normalmente ou redefinir sua senha aqui: <a href=\"{appUrl}/forgot-password\">{appUrl}/forgot-password</a></p><p>Se não foi você, nenhuma ação é necessária.</p>",
    text: "Alguém tentou criar uma conta no AutoEco com este endereço. Nenhuma conta foi criada. Se foi você: {appUrl}/forgot-password",
  },
  trialStarted: {
    subject: "Seu teste gratuito de {days} dias está ativo",
    html: "Olá {name},</p><p>Seu teste gratuito já está ativo. <a href=\"{appUrl}/dashboard\">Vá para seu painel</a> e adicione seu primeiro veículo.</p>",
    text: "Seu teste gratuito de {days} dias está ativo. Vá para {appUrl}/dashboard",
  },
  trialEnding: {
    subject: "Seu teste termina em {days} dia(s)",
    html: "Olá {name},</p><p>Seu teste termina em {days} dia(s). <a href=\"{appUrl}/settings/billing\">Faça upgrade agora</a> para manter o acompanhamento de vários veículos, as previsões e o Ask Your Car.</p>",
    text: "O teste termina em {days} dia(s). Faça upgrade em {appUrl}/settings/billing",
  },
  paymentSuccess: {
    subject: "Pagamento aprovado — {planName} está ativo",
    html: "Olá {name},</p><p>Seu pagamento foi aprovado. O plano <strong>{planName}</strong> já está ativo.</p>",
    text: "Pagamento aprovado — {planName} está ativo.",
  },
  paymentFailed: {
    subject: "Pagamento recusado — ação necessária",
    html: "Olá {name},</p><p>Não conseguimos processar seu pagamento mais recente. <a href=\"{appUrl}/settings/billing\">Atualize sua cobrança</a> para evitar interrupção.</p>",
    text: "Pagamento recusado. Atualize a cobrança em {appUrl}/settings/billing",
  },
  subscriptionCanceled: {
    subject: "Sua assinatura do AutoEco foi cancelada",
    html: "Olá {name},</p><p>Sua assinatura foi cancelada. Você manterá o acesso até <strong>{endDate}</strong>.</p>",
    text: "Assinatura cancelada. Acesso até {endDate}.",
  },
  usageLimitReached: {
    subject: "Você atingiu seu limite de {label}",
    html: "Olá {name},</p><p>Você atingiu seu limite atual de <strong>{label}</strong>. <a href=\"{appUrl}/settings/billing\">Faça upgrade do seu plano</a> para continuar.</p>",
    text: "Você atingiu seu limite de {label}. Faça upgrade em {appUrl}/settings/billing",
  },
};

const de: Record<EmailKey, EmailCopy> = {
  welcome: {
    subject: "Willkommen bei AutoEco",
    html: "Hallo {name},</p><p>Willkommen bei <strong>AutoEco</strong> — dem Finanz-Betriebssystem für Ihr Auto. Fügen Sie Ihr Fahrzeug hinzu, erfassen Sie Kraftstoff und Ausgaben, und AutoEco berechnet, was Ihr Auto wirklich pro Monat und Kilometer kostet.</p><p>Loslegen: <a href=\"{appUrl}/dashboard\">{appUrl}/dashboard</a></p>",
    text: "Willkommen bei AutoEco. Fügen Sie Ihr Auto hinzu und beginnen Sie mit der Erfassung: {appUrl}/dashboard",
  },
  emailVerify: {
    subject: "Bestätigen Sie Ihre AutoEco-E-Mail",
    html: "Hallo {name},</p><p>Bitte bestätigen Sie Ihre E-Mail-Adresse über den folgenden Link:</p><p><a href=\"{link}\">{link}</a></p><p>Dieser Link ist 24 Stunden gültig.</p>",
    text: "Bestätigen Sie Ihre E-Mail: {link} (24 Stunden gültig)",
  },
  passwordReset: {
    subject: "Passwort zurücksetzen – AutoEco",
    html: "Hallo {name},</p><p>Über den folgenden Link können Sie Ihr Passwort zurücksetzen:</p><p><a href=\"{link}\">{link}</a></p><p>Wenn Sie dies nicht angefordert haben, ignorieren Sie diese E-Mail.</p>",
    text: "Passwort zurücksetzen: {link}",
  },
  signupAttemptNotice: {
    subject: "Jemand hat versucht, sich mit Ihrer E-Mail-Adresse zu registrieren",
    html: "Hallo {name},</p><p>Jemand hat versucht, mit dieser E-Mail-Adresse ein AutoEco-Konto zu erstellen. Es wurde kein neues Konto angelegt und alles bleibt unverändert.</p><p>Wenn Sie das waren, melden Sie sich wie gewohnt an oder setzen Sie hier Ihr Passwort zurück: <a href=\"{appUrl}/forgot-password\">{appUrl}/forgot-password</a></p><p>Wenn nicht, ist keine Aktion erforderlich.</p>",
    text: "Jemand hat versucht, mit dieser Adresse ein AutoEco-Konto zu erstellen. Es wurde keines angelegt. Wenn Sie das waren: {appUrl}/forgot-password",
  },
  trialStarted: {
    subject: "Ihr {days}-tägiger kostenloser Test ist aktiv",
    html: "Hallo {name},</p><p>Ihr kostenloser Test ist jetzt aktiv. <a href=\"{appUrl}/dashboard\">Gehen Sie zu Ihrer Übersicht</a> und fügen Sie Ihr erstes Fahrzeug hinzu.</p>",
    text: "Ihr {days}-tägiger kostenloser Test ist aktiv. Gehen Sie zu {appUrl}/dashboard",
  },
  trialEnding: {
    subject: "Ihr Test endet in {days} Tag(en)",
    html: "Hallo {name},</p><p>Ihr Test endet in {days} Tag(en). <a href=\"{appUrl}/settings/billing\">Wechseln Sie jetzt zu einem Plan</a>, um Fahrzeugverwaltung, Prognosen und Ask Your Car zu behalten.</p>",
    text: "Der Test endet in {days} Tag(en). Wechseln Sie zu einem Plan: {appUrl}/settings/billing",
  },
  paymentSuccess: {
    subject: "Zahlung erfolgreich — {planName} ist aktiv",
    html: "Hallo {name},</p><p>Ihre Zahlung war erfolgreich. Der Plan <strong>{planName}</strong> ist jetzt aktiv.</p>",
    text: "Zahlung erfolgreich — {planName} ist aktiv.",
  },
  paymentFailed: {
    subject: "Zahlung fehlgeschlagen — Aktion erforderlich",
    html: "Hallo {name},</p><p>Wir konnten Ihre letzte Zahlung nicht verarbeiten. Bitte <a href=\"{appUrl}/settings/billing\">aktualisieren Sie Ihre Abrechnungsdaten</a>, um Unterbrechungen zu vermeiden.</p>",
    text: "Zahlung fehlgeschlagen. Abrechnung aktualisieren: {appUrl}/settings/billing",
  },
  subscriptionCanceled: {
    subject: "Ihr AutoEco-Abonnement wurde gekündigt",
    html: "Hallo {name},</p><p>Ihr Abonnement wurde gekündigt. Sie behalten den Zugriff bis <strong>{endDate}</strong>.</p>",
    text: "Abonnement gekündigt. Zugriff bis {endDate}.",
  },
  usageLimitReached: {
    subject: "Sie haben Ihr {label}-Limit erreicht",
    html: "Hallo {name},</p><p>Sie haben Ihr aktuelles <strong>{label}</strong>-Limit erreicht. <a href=\"{appUrl}/settings/billing\">Erweitern Sie Ihren Plan</a>, um fortzufahren.</p>",
    text: "Sie haben Ihr {label}-Limit erreicht. Plan erweitern: {appUrl}/settings/billing",
  },
};

/** English exists for every key; the shipped locales are exactly these five. */
const dicts: Partial<Record<Locale, Record<EmailKey, EmailCopy>>> = { en, fr, es, "pt-BR": ptBR, de };

/**
 * The shipped locales that hold real email copy. Arabic is pending and falls
 * back to English (via `en`) until the RTL change lands.
 */
export const EMAIL_READY_LOCALES: readonly Locale[] = ["en", "fr", "es", "pt-BR", "de"];

function pick(locale: Locale): Record<EmailKey, EmailCopy> {
  return dicts[locale] ?? en;
}

export function renderEmailCopy(
  locale: Locale,
  key: EmailKey,
  params: Record<string, string | number>
): EmailCopy {
  const copy = pick(locale)[key] ?? en[key];
  return {
    subject: fill(copy.subject, params),
    html: "<p>" + fill(copy.html, params),
    text: fill(copy.text, params),
  };
}

function fill(template: string, params: Record<string, string | number>): string {
  return template.replace(/\{(\w+)\}/g, (whole, name: string) =>
    Object.prototype.hasOwnProperty.call(params, name) ? String(params[name]) : whole
  );
}