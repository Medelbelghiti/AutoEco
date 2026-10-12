import { type Locale } from "./i18n";

/**
 * Which language the ownership-cost PDF is written in, and the words it uses.
 *
 * The document is drawn with the WinAnsi (Latin-1) built-in fonts, so it can
 * carry French, Spanish, Portuguese and German diacritics but no Arabic. That
 * is the whole reason `canPdfRender` exists: it is the one place that decides
 * whether a user gets a translated PDF or the English one, and it is what the
 * download button uses to decide whether to warn about the language.
 *
 * Every string here is WinAnsi-safe by construction (rule 8 of the i18n
 * review), and `tests/i18n.test.ts` asserts that no label escapes Latin-1.
 */
export function canPdfRender(locale: Locale): boolean {
  return locale !== "ar";
}

export interface PdfText {
  title: string;
  summary: string;
  notRecorded: string;

  thMeasure: string;
  thValue: string;
  monthsOfData: string;
  totalSpentActual: string;
  distanceActual: string;
  monthlyAverageActual: string;
  annualForecast: string;
  costPerUnit: string;

  thCategory: string;
  thAmount: string;
  byCategory: string;

  thDate: string;
  thMerchant: string;
  thKm: string;
  thMiles: string;
  expensesCaption: string;
  omittedOne: string;
  omittedOther: string;

  forecastHeading: string;
  depreciationHeading: string;
  methodLabel: string;
  totalDepreciationLabel: string;

  trueCostHeading: string;
  thComponent: string;
  thBasis: string;
  componentOperating: string;
  componentForwardFixed: string;
  componentDepreciation: string;
  notProvided: string;
  purchaseLine: string;
  assumptionsHeading: string;

  sourceActual: string;
  sourceEstimate: string;
  sourceForecast: string;

  standingDisclaimer: string;
  footerDisclaimer: string;
  generatedStamp: string;
}

const en: PdfText = {
  title: "Ownership cost report",
  summary: "Summary",
  notRecorded: "Not recorded",

  thMeasure: "Measure",
  thValue: "Value",
  monthsOfData: "Months of data",
  totalSpentActual: "Total recorded spending (ACTUAL)",
  distanceActual: "Distance driven (ACTUAL)",
  monthlyAverageActual: "Monthly average (ACTUAL)",
  annualForecast: "Estimated annual cost (FORECAST)",
  costPerUnit: "Cost per {unit} (ACTUAL)",

  thCategory: "Category",
  thAmount: "Amount",
  byCategory: "By category",

  thDate: "Date",
  thMerchant: "Merchant",
  thKm: "km",
  thMiles: "Miles",
  expensesCaption: "Expenses ({listed} of {total})",
  omittedOne: "{n} earlier entry is not listed. The totals above include all {total} entries.",
  omittedOther: "{n} earlier entries are not listed. The totals above include all {total} entries.",

  forecastHeading: "Forecast, next 12 months",
  depreciationHeading: "Depreciation (ESTIMATE)",
  methodLabel: "Method",
  totalDepreciationLabel: "Total estimated depreciation",

  trueCostHeading: "True cost of ownership (3-year horizon)",
  thComponent: "Component",
  thBasis: "Basis",
  componentOperating: "All recorded expenses (FORECAST, flat)",
  componentForwardFixed: "Forward fixed (FORECAST)",
  componentDepreciation: "Depreciation (ESTIMATE)",
  notProvided: "not provided",
  purchaseLine: "Purchase price {price}, purchased {date}, estimated resale {resale}.",
  assumptionsHeading: "Assumptions",

  sourceActual: "ACTUAL",
  sourceEstimate: "ESTIMATE",
  sourceForecast: "FORECAST",

  standingDisclaimer:
    "Every figure above is ACTUAL (from data you recorded), ESTIMATE (from a stated assumption) or FORECAST (a projection). AutoEco analyses the data you enter; it does not diagnose a vehicle or tell you what a vehicle or a deduction is worth.",
  footerDisclaimer: "Estimates based on data you entered. Not financial, tax or valuation advice.",
  generatedStamp: "Generated {date}",
};

const fr: PdfText = {
  title: "Rapport de coût de possession",
  summary: "Résumé",
  notRecorded: "Non enregistré",

  thMeasure: "Indicateur",
  thValue: "Valeur",
  monthsOfData: "Mois de données",
  totalSpentActual: "Dépenses totales enregistrées (ACTUAL)",
  distanceActual: "Distance parcourue (ACTUAL)",
  monthlyAverageActual: "Moyenne mensuelle (ACTUAL)",
  annualForecast: "Coût annuel estimé (FORECAST)",
  costPerUnit: "Coût par {unit} (ACTUAL)",

  thCategory: "Catégorie",
  thAmount: "Montant",
  byCategory: "Par catégorie",

  thDate: "Date",
  thMerchant: "Marchand",
  thKm: "km",
  thMiles: "Miles",
  expensesCaption: "Dépenses ({listed} sur {total})",
  omittedOne: "{n} écriture antérieure n'est pas listée. Les totaux ci-dessus incluent les {total} écritures.",
  omittedOther: "{n} écritures antérieures ne sont pas listées. Les totaux ci-dessus incluent les {total} écritures.",

  forecastHeading: "Prévision, 12 prochains mois",
  depreciationHeading: "Dépréciation (ESTIMATE)",
  methodLabel: "Méthode",
  totalDepreciationLabel: "Dépréciation totale estimée",

  trueCostHeading: "Coût réel de possession (horizon 3 ans)",
  thComponent: "Composante",
  thBasis: "Base",
  componentOperating: "Toutes les dépenses enregistrées (FORECAST, flat)",
  componentForwardFixed: "Frais fixes futurs (FORECAST)",
  componentDepreciation: "Dépréciation (ESTIMATE)",
  notProvided: "non renseigné",
  purchaseLine: "Prix d'achat {price}, acheté le {date}, revente estimée {resale}.",
  assumptionsHeading: "Hypothèses",

  sourceActual: "ACTUAL",
  sourceEstimate: "ESTIMATE",
  sourceForecast: "FORECAST",

  standingDisclaimer:
    "Chaque chiffre ci-dessus est ACTUAL (issue des données enregistrées), ESTIMATE (calculé à partir d'une hypothèse) ou FORECAST (projection). AutoEco analyse les données que vous saisissez ; il ne diagnostique pas un véhicule et n'évalue ni un véhicule ni une déduction.",
  footerDisclaimer: "Estimations à partir des données saisies. Ne constitue pas un avis financier, fiscal ou d'évaluation.",
  generatedStamp: "Généré le {date}",
};

const es: PdfText = {
  title: "Informe de coste de propiedad",
  summary: "Resumen",
  notRecorded: "No registrado",

  thMeasure: "Medida",
  thValue: "Valor",
  monthsOfData: "Meses de datos",
  totalSpentActual: "Gasto total registrado (ACTUAL)",
  distanceActual: "Distancia recorrida (ACTUAL)",
  monthlyAverageActual: "Media mensual (ACTUAL)",
  annualForecast: "Coste anual estimado (FORECAST)",
  costPerUnit: "Coste por {unit} (ACTUAL)",

  thCategory: "Categoría",
  thAmount: "Importe",
  byCategory: "Por categoría",

  thDate: "Fecha",
  thMerchant: "Comercio",
  thKm: "km",
  thMiles: "Millas",
  expensesCaption: "Gastos ({listed} de {total})",
  omittedOne: "No se lista {n} movimiento anterior. Los totales de arriba incluyen los {total} movimientos.",
  omittedOther: "No se listan {n} movimientos anteriores. Los totales de arriba incluyen los {total} movimientos.",

  forecastHeading: "Previsión, próximos 12 meses",
  depreciationHeading: "Depreciación (ESTIMATE)",
  methodLabel: "Método",
  totalDepreciationLabel: "Depreciación total estimada",

  trueCostHeading: "Coste real de propiedad (horizonte de 3 años)",
  thComponent: "Componente",
  thBasis: "Base",
  componentOperating: "Todos los gastos registrados (FORECAST, plano)",
  componentForwardFixed: "Costes fijos futuros (FORECAST)",
  componentDepreciation: "Depreciación (ESTIMATE)",
  notProvided: "no indicado",
  purchaseLine: "Precio de compra {price}, comprado el {date}, reventa estimada {resale}.",
  assumptionsHeading: "Supuestos",

  sourceActual: "ACTUAL",
  sourceEstimate: "ESTIMATE",
  sourceForecast: "FORECAST",

  standingDisclaimer:
    "Cada cifra de arriba es ACTUAL (de los datos registrados), ESTIMATE (calculado a partir de un supuesto) o FORECAST (proyección). AutoEco analiza los datos que introduces; no diagnostica un vehículo ni determina el valor de un vehículo o de una deducción.",
  footerDisclaimer: "Estimaciones a partir de los datos introducidos. No es asesoramiento financiero, fiscal ni de valoración.",
  generatedStamp: "Generado el {date}",
};

const ptBR: PdfText = {
  title: "Relatório de custo de propriedade",
  summary: "Resumo",
  notRecorded: "Não registrado",

  thMeasure: "Medida",
  thValue: "Valor",
  monthsOfData: "Meses de dados",
  totalSpentActual: "Gasto total registrado (ACTUAL)",
  distanceActual: "Distância percorrida (ACTUAL)",
  monthlyAverageActual: "Média mensal (ACTUAL)",
  annualForecast: "Custo anual estimado (FORECAST)",
  costPerUnit: "Custo por {unit} (ACTUAL)",

  thCategory: "Categoria",
  thAmount: "Valor",
  byCategory: "Por categoria",

  thDate: "Data",
  thMerchant: "Comerciante",
  thKm: "km",
  thMiles: "Milhas",
  expensesCaption: "Despesas ({listed} de {total})",
  omittedOne: "{n} lançamento anterior não está listado. Os totais acima incluem todos os {total} lançamentos.",
  omittedOther: "{n} lançamentos anteriores não estão listados. Os totais acima incluem todos os {total} lançamentos.",

  forecastHeading: "Previsão, próximos 12 meses",
  depreciationHeading: "Depreciação (ESTIMATE)",
  methodLabel: "Método",
  totalDepreciationLabel: "Depreciação total estimada",

  trueCostHeading: "Custo real de propriedade (horizonte de 3 anos)",
  thComponent: "Componente",
  thBasis: "Base",
  componentOperating: "Todas as despesas registradas (FORECAST, plana)",
  componentForwardFixed: "Custos fixos futuros (FORECAST)",
  componentDepreciation: "Depreciação (ESTIMATE)",
  notProvided: "não informado",
  purchaseLine: "Preço de compra {price}, comprado em {date}, revenda estimada {resale}.",
  assumptionsHeading: "Premissas",

  sourceActual: "ACTUAL",
  sourceEstimate: "ESTIMATE",
  sourceForecast: "FORECAST",

  standingDisclaimer:
    "Cada número acima é ACTUAL (dos dados registrados), ESTIMATE (calculado a partir de uma premissa) ou FORECAST (projeção). O AutoEco analisa os dados que você informa; não diagnostica um veículo nem informa o valor de um veículo ou de uma dedução.",
  footerDisclaimer: "Estimativas com base nos dados informados. Não é aconselhamento financeiro, fiscal ou de avaliação.",
  generatedStamp: "Gerado em {date}",
};

const de: PdfText = {
  title: "Bericht zu den Betriebskosten",
  summary: "Übersicht",
  notRecorded: "Nicht erfasst",

  thMeasure: "Kennzahl",
  thValue: "Wert",
  monthsOfData: "Monate mit Daten",
  totalSpentActual: "Erfasste Gesamtausgaben (ACTUAL)",
  distanceActual: "Gefahrene Strecke (ACTUAL)",
  monthlyAverageActual: "Monatlicher Durchschnitt (ACTUAL)",
  annualForecast: "Geschätzte Jahreskosten (FORECAST)",
  costPerUnit: "Kosten pro {unit} (ACTUAL)",

  thCategory: "Kategorie",
  thAmount: "Betrag",
  byCategory: "Nach Kategorie",

  thDate: "Datum",
  thMerchant: "Händler",
  thKm: "km",
  thMiles: "Meilen",
  expensesCaption: "Ausgaben ({listed} von {total})",
  omittedOne: "{n} frühere Buchung ist nicht aufgeführt. Die Summen oben enthalten alle {total} Buchungen.",
  omittedOther: "{n} frühere Buchungen sind nicht aufgeführt. Die Summen oben enthalten alle {total} Buchungen.",

  forecastHeading: "Prognose, nächste 12 Monate",
  depreciationHeading: "Abwertung (ESTIMATE)",
  methodLabel: "Methode",
  totalDepreciationLabel: "Geschätzte Gesamtabwertung",

trueCostHeading: "Tatsächliche Besitzkosten (Zeithorizont 3 Jahre)",
  thComponent: "Komponente",
  thBasis: "Basis",
  componentOperating: "Alle erfassten Ausgaben (FORECAST, konstant)",
  componentForwardFixed: "Zukünftige Fixkosten (FORECAST)",
  componentDepreciation: "Wertminderung (ESTIMATE)",
  notProvided: "nicht angegeben",
  purchaseLine: "Kaufpreis {price}, gekauft am {date}, geschätzter Wiederverkauf {resale}.",
  assumptionsHeading: "Annahmen",

  sourceActual: "ACTUAL",
  sourceEstimate: "ESTIMATE",
  sourceForecast: "FORECAST",

  standingDisclaimer:
    "Jede Zahl oben ist ACTUAL (aus Ihren erfassten Daten), ESTIMATE (berechnet aus einer Annahme) oder FORECAST (Hochrechnung). AutoEco wertet die von Ihnen eingegebenen Daten aus; es diagnostiziert kein Fahrzeug und bewertet weder ein Fahrzeug noch einen Abzug.",
  footerDisclaimer: "Schätzungen auf Basis Ihrer eingegebenen Daten. Keine Finanz-, Steuer- oder Bewertungsberatung.",
  generatedStamp: "Erstellt am {date}",
};

const TABLE: Record<Locale, PdfText> = {
  en,
  fr,
  es,
  "pt-BR": ptBR,
  de,
  // The WinAnsi fonts cannot draw Arabic, so the Arabic PDF is the English one.
  ar: en,
};

export function pdfText(locale: Locale): PdfText {
  return TABLE[locale] ?? en;
}
