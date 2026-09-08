// currency.js
// Formatação de preços com suporte a várias moedas (euro, real, dólar, ...).
// O Stripe cobra na moeda definida em cada produto; aqui só tratamos de mostrar
// o valor com o símbolo e os separadores certos para cada moeda.

// Locale usado para cada moeda, para o símbolo e os separadores saírem corretos
// (ex.: BRL -> "R$ 1,20", EUR -> "1,20 €", USD -> "$1.20").
const CURRENCY_LOCALES = {
  EUR: 'pt-PT',
  BRL: 'pt-BR',
  USD: 'en-US',
  GBP: 'en-GB',
};

const DEFAULT_LOCALE = 'pt-PT';

function formatPrice(cents, currency) {
  const code = String(currency || 'eur').toUpperCase();
  const amount = Number(cents) / 100;
  try {
    return new Intl.NumberFormat(CURRENCY_LOCALES[code] || DEFAULT_LOCALE, {
      style: 'currency',
      currency: code,
    }).format(amount);
  } catch {
    // Moeda não reconhecida pelo Intl — mostra o valor com o código da moeda.
    return `${amount.toFixed(2)} ${code}`;
  }
}

module.exports = { formatPrice, CURRENCY_LOCALES };
