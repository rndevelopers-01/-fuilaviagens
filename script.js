/* ============================================
   Fui Lá Excursões - Vanilla JS
   ============================================ */

const PHONE = "5521976971474";

let pacotes = [];

function formatBRL(v) {
  return v.toLocaleString("pt-BR", { style: "currency", currency: "BRL" });
}

function whatsappLink(text) {
  return `https://api.whatsapp.com/send/?phone=${PHONE}&text=${encodeURIComponent(text)}&type=phone_number&app_absent=0`;
}

function el(html) {
  const t = document.createElement("template");
  t.innerHTML = html.trim();
  return t.content.firstChild;
}

function escapeHtml(s) {
  return String(s)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

function statusBadgeClass(status) {
  if (status === "soldout") return "status-soldout";
  if (status === "limited") return "status-limited";
  return "status-available";
}

/* ============================================
   FOOTER YEAR
   ============================================ */
document.getElementById("footer-year").textContent = new Date().getFullYear();

/* ============================================
   SMOOTH SCROLL FOR NAV LINKS
   ============================================ */
document.querySelectorAll('a[href^="#"]').forEach((a) => {
  a.addEventListener("click", (e) => {
    const id = a.getAttribute("href").slice(1);
    if (!id) return;
    const target = document.getElementById(id);
    if (target) {
      e.preventDefault();
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      history.replaceState(null, "", `#${id}`);
    }
  });
});

/* ============================================
   RENDER DESTINATIONS
   ============================================ */
function renderDestinations() {
  const grid = document.getElementById("destinations-grid");
  grid.innerHTML = "";

  if (!pacotes.length) {
    grid.innerHTML = `
      <div class="destinations-empty">
        <h3>Novas excursões em breve</h3>
        <p>A equipe está preparando os próximos destinos. Volte para conferir as novidades.</p>
      </div>`;
    return;
  }

  pacotes.forEach((p) => {
    const isSoldOut = p.status === "soldout";
    const statusLabel = isSoldOut ? "ESGOTADO" : p.availableSeats <= 10
      ? `${p.availableSeats} ${p.availableSeats === 1 ? "lugar" : "lugares"}`
      : "DISPONÍVEL";
    const card = el(`
      <article class="card ${isSoldOut ? "card-soldout" : ""}">
        <button type="button" class="card-image-btn" data-pacote-id="${p.id}" ${isSoldOut ? "disabled" : ""}>
          <div class="card-image">
            <img src="${escapeHtml(p.image)}" alt="Excursão para ${escapeHtml(p.destino)}" loading="lazy" class="${isSoldOut ? "img-grayscale" : ""}" />
            <span class="status-badge ${statusBadgeClass(p.status)}">${escapeHtml(statusLabel)}</span>
            ${isSoldOut ? `<div class="soldout-overlay"><span class="soldout-stamp">ESGOTADO</span></div>` : ""}
          </div>
        </button>
        <div class="card-body">
          <p class="card-eyebrow">Excursão</p>
          <h3 class="card-title">${escapeHtml(p.destino)}</h3>
          <p class="card-date">Data: ${escapeHtml(p.data)}</p>
          <div class="card-prices">
            <span class="price-main">${formatBRL(p.priceAdult)}</span>
            <span class="price-unit">/ pessoa · a partir de ${p.minAge} anos</span>
          </div>
          ${p.installments ? `<p class="price-extra">Em até <strong>${p.installments.count}x de ${formatBRL(p.installments.value)}</strong> no cartão</p>` : ""}
          <div class="card-cta">
            ${isSoldOut
              ? `<a href="${whatsappLink(`Olá! Quero ser avisada(o) quando abrir nova turma de ${p.destino} (${p.data}).`)}" target="_blank" rel="noopener noreferrer" class="btn btn-waitlist">
                   <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.9 20A9 9 0 1 0 4 16.1L2 22Z"/></svg>
                   Avise-me quando abrir
                 </a>`
              : `<button type="button" class="btn btn-accent" data-pacote-id="${p.id}">
                   <svg class="icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
                   Comprar pacote
                 </button>`}
          </div>
        </div>
      </article>
    `);
    grid.appendChild(card);
  });

  grid.querySelectorAll("button[data-pacote-id]").forEach((btn) => {
    btn.addEventListener("click", () => {
      const id = btn.getAttribute("data-pacote-id");
      const p = pacotes.find((x) => x.id === id);
      if (p && p.status !== "soldout") openCheckout(p);
    });
  });
}

function formatExcursionDate(value) {
  const date = new Date(`${value}T12:00:00-03:00`);
  return new Intl.DateTimeFormat("pt-BR", { dateStyle: "long", timeZone: "America/Sao_Paulo" }).format(date);
}

async function loadExcursions() {
  const grid = document.getElementById("destinations-grid");
  try {
    const response = await fetch("/api/excursions", { headers: { Accept: "application/json" } });
    if (!response.ok) throw new Error("Não foi possível carregar as excursões.");
    const rows = await response.json();
    pacotes = rows.map((row) => {
      const price = row.priceCents / 100;
      const availableSeats = Number(row.availableSeats);
      return {
        id: String(row.id),
        destino: row.title,
        data: formatExcursionDate(row.departureDate),
        image: row.imageUrl,
        priceAdult: price,
        priceCents: row.priceCents,
        minAge: row.minAge,
        availableSeats,
        status: availableSeats === 0 ? "soldout" : availableSeats <= 10 ? "limited" : "available",
        statusLabel: availableSeats === 0 ? "ESGOTADO" : availableSeats <= 10
          ? `${availableSeats} ${availableSeats === 1 ? "lugar" : "lugares"}`
          : "DISPONÍVEL",
        installments: row.installmentsCount > 0
          ? { count: row.installmentsCount, value: price / row.installmentsCount }
          : null,
      };
    });
    renderDestinations();
  } catch {
    grid.innerHTML = `
      <div class="destinations-empty destinations-error">
        <h3>Não foi possível carregar as excursões</h3>
        <p>Confira sua conexão e tente novamente.</p>
        <button type="button" class="btn btn-outline" id="retry-excursions">Tentar novamente</button>
      </div>`;
    document.getElementById("retry-excursions")?.addEventListener("click", loadExcursions);
  }
}
renderDestinations();
loadExcursions();

fetch("/api/analytics/pageview", {
  method: "POST",
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify({ path: location.pathname === "/payment/return" ? "/payment/return" : "/" }),
}).catch(() => {});

/* ============================================
   TOAST
   ============================================ */
function toast({ title, description, variant = "success" }) {
  const c = document.getElementById("toast-container");
  const t = el(`
    <div class="toast ${variant}">
      <div class="toast-title">${escapeHtml(title)}</div>
      ${description ? `<div class="toast-desc">${escapeHtml(description)}</div>` : ""}
    </div>
  `);
  c.appendChild(t);
  setTimeout(() => {
    t.style.transition = "opacity 0.3s, transform 0.3s";
    t.style.opacity = "0";
    t.style.transform = "translateX(20px)";
    setTimeout(() => t.remove(), 300);
  }, 4000);
}

/* ============================================
   SEARCH MODAL
   ============================================ */
const searchModal = document.getElementById("search-modal");
const searchInput = document.getElementById("search-input");
const searchResults = document.getElementById("search-results");
const searchMoreWrap = document.getElementById("search-more-wrap");
const searchMoreBtn = document.getElementById("search-more-btn");
const PAGE_SIZE = 4;
let searchVisible = PAGE_SIZE;

function normalize(s) {
  return s.toLowerCase().normalize("NFD").replace(/[\u0300-\u036f]/g, "");
}

function getSearchResults() {
  const q = normalize(searchInput.value.trim());
  if (!q) return pacotes;
  return pacotes.filter(
    (p) => normalize(p.destino).includes(q) || normalize(p.data).includes(q)
  );
}

function renderSearchResults() {
  const results = getSearchResults();
  searchResults.innerHTML = "";

  if (results.length === 0) {
    searchResults.appendChild(el(`
      <div class="search-empty">
        <p>Nenhuma excursão encontrada para <strong>"${escapeHtml(searchInput.value)}"</strong>.</p>
        <p style="font-size:0.875rem;margin-top:0.5rem;">Tente outro destino ou fale com a gente no WhatsApp.</p>
      </div>
    `));
    searchMoreWrap.classList.add("hidden");
    return;
  }

  results.slice(0, searchVisible).forEach((p) => {
    const isSoldOut = p.status === "soldout";
    const minPrice = p.priceAdult;
    const row = el(`
      <button type="button" class="search-result ${isSoldOut ? "search-result-soldout" : ""}" data-pacote-id="${p.id}" ${isSoldOut ? "disabled" : ""}>
        <div class="search-result-img">
          <img src="${escapeHtml(p.image)}" alt="${escapeHtml(p.destino)}" loading="lazy" class="${isSoldOut ? "img-grayscale" : ""}" />
        </div>
        <div class="search-result-info">
          <div style="display:flex;align-items:center;gap:0.5rem;flex-wrap:wrap;">
            <p class="card-eyebrow" style="margin-bottom:0;">Excursão</p>
            ${p.statusLabel ? `<span class="status-badge-sm ${statusBadgeClass(p.status)}">${escapeHtml(p.statusLabel)}</span>` : ""}
          </div>
          <h4>${escapeHtml(p.destino)}</h4>
          <p class="date">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect width="18" height="18" x="3" y="4" rx="2"/><path d="M16 2v4"/><path d="M8 2v4"/><path d="M3 10h18"/></svg>
            ${escapeHtml(p.data)}
          </p>
          <p class="price">A partir de ${formatBRL(minPrice)}</p>
        </div>
        <svg class="icon-shop" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" style="${isSoldOut ? "color:#cbd5e1;" : ""}"><path d="M6 2 3 6v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V6l-3-4Z"/><path d="M3 6h18"/><path d="M16 10a4 4 0 0 1-8 0"/></svg>
      </button>
    `);
    if (!isSoldOut) {
      row.addEventListener("click", () => {
        const p2 = pacotes.find((x) => x.id === p.id);
        closeSearch();
        setTimeout(() => openCheckout(p2), 150);
      });
    }
    searchResults.appendChild(row);
  });

  if (results.length > searchVisible) {
    searchMoreWrap.classList.remove("hidden");
  } else {
    searchMoreWrap.classList.add("hidden");
  }
}

function openSearch() {
  searchModal.classList.add("open");
  searchModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  searchInput.value = "";
  searchVisible = PAGE_SIZE;
  renderSearchResults();
  setTimeout(() => searchInput.focus(), 50);
}
function closeSearch() {
  searchModal.classList.remove("open");
  searchModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
}

document.querySelectorAll('[data-action="open-search"]').forEach((b) =>
  b.addEventListener("click", openSearch)
);
document.querySelectorAll('[data-action="close-search"]').forEach((b) =>
  b.addEventListener("click", closeSearch)
);
searchInput.addEventListener("input", () => {
  searchVisible = PAGE_SIZE;
  renderSearchResults();
});
searchMoreBtn.addEventListener("click", () => {
  searchVisible += PAGE_SIZE;
  renderSearchResults();
});

/* ============================================
   CHECKOUT MODAL
   ============================================ */
const checkoutModal = document.getElementById("checkout-modal");
const checkoutBody = document.getElementById("checkout-body");
const checkoutSubtitle = document.getElementById("checkout-subtitle");

let currentPacote = null;
let bookingSeats = 1;
let bookingParticipants = [];
let bookingCoupon = "";
let bookingQuote = null;

function openCheckout(p) {
  currentPacote = p;
  bookingSeats = 1;
  bookingParticipants = [];
  bookingCoupon = "";
  bookingQuote = null;
  checkoutSubtitle.innerHTML = `<strong>${escapeHtml(p.destino)}</strong> · <span class="muted">${escapeHtml(p.data)}</span>`;
  checkoutModal.classList.add("open");
  checkoutModal.setAttribute("aria-hidden", "false");
  document.body.style.overflow = "hidden";
  renderCheckoutOptions();
}
function closeCheckout() {
  checkoutModal.classList.remove("open");
  checkoutModal.setAttribute("aria-hidden", "true");
  document.body.style.overflow = "";
  currentPacote = null;
  bookingParticipants = [];
}

document.querySelectorAll('[data-action="close-checkout"]').forEach((b) =>
  b.addEventListener("click", closeCheckout)
);

function renderCheckoutOptions() {
  const p = currentPacote;
  const maxSeats = Math.min(20, p.availableSeats);
  const subtotal = p.priceCents * bookingSeats;
  const total = bookingQuote?.totalCents ?? subtotal;
  checkoutBody.innerHTML = `
    <div class="checkout-step">
      <div class="field">
        <label for="ck-seats">Quantas pessoas vão viajar?</label>
        <select id="ck-seats">
          ${Array.from({ length: maxSeats }, (_, index) =>
            `<option value="${index + 1}" ${index + 1 === bookingSeats ? "selected" : ""}>${index + 1} ${index === 0 ? "pessoa" : "pessoas"}</option>`
          ).join("")}
        </select>
      </div>
      <div class="checkout-price-box">
        <span>Valor por pessoa</span><strong>${formatBRL(p.priceAdult)}</strong>
        ${bookingQuote?.discountCents ? `<span>Desconto do cupom</span><strong>− ${formatBRL(bookingQuote.discountCents / 100)}</strong>` : ""}
        <span>Total</span><strong>${formatBRL(total / 100)}</strong>
      </div>
      ${p.installments ? `<p class="installments-note">No cartão, em até ${p.installments.count}x. O Mercado Pago mostra as condições finais.</p>` : ""}
      <div class="coupon-entry">
        <div class="field">
          <label for="ck-coupon">Cupom de desconto</label>
          <input id="ck-coupon" value="${escapeHtml(bookingCoupon)}" autocomplete="off" placeholder="Digite o código" />
        </div>
        <button type="button" class="btn btn-outline" id="ck-apply-coupon">Aplicar</button>
      </div>
      <p id="coupon-message" class="form-hint" aria-live="polite"></p>
      <button type="button" class="btn btn-accent btn-block" id="checkout-continue" ${maxSeats < 1 ? "disabled" : ""}>
        Informar passageiros
      </button>
    </div>
  `;
  document.getElementById("ck-seats").addEventListener("change", (event) => {
    bookingSeats = Number(event.target.value);
    bookingQuote = null;
    bookingCoupon = "";
    renderCheckoutOptions();
  });
  document.getElementById("ck-coupon").addEventListener("input", (event) => {
    bookingCoupon = event.target.value.trim();
    bookingQuote = null;
    document.getElementById("coupon-message").textContent = "";
  });
  document.getElementById("ck-apply-coupon").addEventListener("click", async () => {
    const button = document.getElementById("ck-apply-coupon");
    const message = document.getElementById("coupon-message");
    bookingCoupon = document.getElementById("ck-coupon").value.trim();
    button.disabled = true;
    message.textContent = "Conferindo cupom…";
    if (!bookingCoupon) {
      bookingQuote = null;
      renderCheckoutOptions();
      return;
    }
    try {
      const response = await fetch("/api/coupons/preview", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          excursionId: p.id,
          seats: bookingSeats,
          code: bookingCoupon,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Cupom inválido.");
      bookingQuote = data;
      renderCheckoutOptions();
      document.getElementById("coupon-message").textContent = "Cupom aplicado.";
    } catch (error) {
      bookingQuote = null;
      message.textContent = error.message;
    } finally {
      const currentButton = document.getElementById("ck-apply-coupon");
      if (currentButton) currentButton.disabled = false;
    }
  });
  document.getElementById("checkout-continue").addEventListener("click", renderCheckoutCustomer);
}

function renderCheckoutCustomer() {
  bookingParticipants = Array.from({ length: bookingSeats }, (_, index) =>
    bookingParticipants[index] || { firstName: "", lastName: "", cpf: "", email: "", phone: "", age: "" }
  );
  const participantForms = bookingParticipants.map((person, index) => `
    <section class="participant-card" aria-labelledby="passenger-${index}-title">
      <h3 id="passenger-${index}-title">Passageiro ${index + 1}</h3>
      <div class="form-row two-col">
        <div class="field">
          <label for="passenger-${index}-first">Nome*</label>
          <input id="passenger-${index}-first" data-person="${index}" data-field="firstName" value="${escapeHtml(person.firstName)}" autocomplete="given-name" required />
        </div>
        <div class="field">
          <label for="passenger-${index}-last">Sobrenome*</label>
          <input id="passenger-${index}-last" data-person="${index}" data-field="lastName" value="${escapeHtml(person.lastName)}" autocomplete="family-name" required />
        </div>
      </div>
      <div class="form-row two-col">
        <div class="field">
          <label for="passenger-${index}-cpf">CPF*</label>
          <input id="passenger-${index}-cpf" data-person="${index}" data-field="cpf" value="${escapeHtml(person.cpf)}" placeholder="000.000.000-00" inputmode="numeric" autocomplete="off" required />
        </div>
        <div class="field">
          <label for="passenger-${index}-age">Idade*</label>
          <input id="passenger-${index}-age" data-person="${index}" data-field="age" value="${escapeHtml(person.age)}" type="number" min="${pMinAge()}" max="120" inputmode="numeric" required />
        </div>
      </div>
      <div class="field">
        <label for="passenger-${index}-email">E-mail*</label>
        <input id="passenger-${index}-email" data-person="${index}" data-field="email" value="${escapeHtml(person.email)}" type="email" autocomplete="email" required />
      </div>
      <div class="field">
        <label for="passenger-${index}-phone">Telefone*</label>
        <input id="passenger-${index}-phone" data-person="${index}" data-field="phone" value="${escapeHtml(person.phone)}" type="tel" inputmode="tel" autocomplete="tel" required />
      </div>
    </section>
  `).join("");
  checkoutBody.innerHTML = `
    <div class="checkout-passengers">
      ${participantForms}
      <p class="privacy-consent">
        Os dados de cada passageiro são usados para administrar a reserva. O pagamento
        acontece no ambiente seguro do Mercado Pago; este site não recebe os dados do cartão.
        Consulte a <a href="/privacidade" target="_blank" rel="noopener">política de privacidade</a>.
      </p>
      <label class="consent-row">
        <input type="checkbox" id="ck-consent" />
        <span>Autorizo o uso dos dados informados para esta reserva.</span>
      </label>
      <div class="checkout-actions">
        <button type="button" class="btn btn-outline" id="ck-back">Voltar</button>
        <button type="button" class="btn btn-accent" id="ck-next">Continuar para pagamento</button>
      </div>
    </div>
  `;

  checkoutBody.querySelectorAll("[data-person][data-field]").forEach((input) => {
    input.addEventListener("input", () => {
      bookingParticipants[Number(input.dataset.person)][input.dataset.field] = input.value;
    });
  });
  document.getElementById("ck-back").addEventListener("click", () => renderCheckoutOptions());
  document.getElementById("ck-next").addEventListener("click", () => {
    if (!document.getElementById("ck-consent").checked) {
      toast({
        variant: "error",
        title: "Confirme o uso dos dados",
        description: "É necessário autorizar o uso dos dados para continuar a reserva.",
      });
      return;
    }
    for (const person of bookingParticipants) {
      if (
        person.firstName.trim().length < 2 ||
        person.lastName.trim().length < 2 ||
        person.cpf.replace(/\D/g, "").length !== 11 ||
        !/^\S+@\S+\.\S+$/.test(person.email) ||
        person.phone.replace(/\D/g, "").length < 10 ||
        Number(person.age) < currentPacote.minAge
      ) {
        toast({
          variant: "error",
          title: "Confira os dados dos passageiros",
          description: `Preencha nome, sobrenome, CPF, idade mínima de ${currentPacote.minAge} anos, e-mail e telefone de cada pessoa.`,
        });
        return;
      }
    }
    renderCheckoutMethod();
  });
}

function pMinAge() {
  return currentPacote?.minAge ?? 0;
}

function renderCheckoutMethod() {
  const totalCents = bookingQuote?.totalCents ?? currentPacote.priceCents * bookingSeats;
  checkoutBody.innerHTML = `
    <div class="checkout-payment">
      <div class="checkout-price-box">
        <span>Destino</span><strong>${escapeHtml(currentPacote.destino)}</strong>
        <span>Passageiros</span><strong>${bookingSeats}</strong>
        <span>Total</span><strong>${formatBRL(totalCents / 100)}</strong>
      </div>
      <div class="payment-options-note">
        <h3>Pagamento pelo Mercado Pago</h3>
        <p>Na próxima etapa você poderá escolher Pix, cartão de crédito ou cartão de débito. Os dados do cartão não passam por este site.</p>
      </div>
      <button type="button" class="btn btn-accent btn-block" id="checkout-pay">Ir para o pagamento seguro</button>
      <div class="checkout-actions">
        <button type="button" class="btn btn-outline btn-block" id="ck-back-2">Voltar aos passageiros</button>
      </div>
    </div>
  `;

  document.getElementById("ck-back-2").addEventListener("click", () => renderCheckoutCustomer());
  document.getElementById("checkout-pay").addEventListener("click", async (event) => {
    const button = event.currentTarget;
    button.disabled = true;
    button.textContent = "Preparando pagamento…";
    try {
      const response = await fetch("/api/orders", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          excursionId: currentPacote.id,
          couponCode: bookingCoupon,
          participants: bookingParticipants,
        }),
      });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error || "Não foi possível iniciar o pagamento.");
      window.location.assign(data.checkoutUrl);
    } catch (error) {
      button.disabled = false;
      button.textContent = "Ir para o pagamento seguro";
      toast({
        variant: "error",
        title: "Não foi possível iniciar a compra",
        description: error.message,
      });
    }
  });
}

async function showPaymentReturn() {
  if (location.pathname !== "/payment/return") return;
  const params = new URLSearchParams(location.search);
  const orderId = params.get("order");
  const token = params.get("token");
  const banner = el(`
    <section class="payment-return-banner" role="status" aria-live="polite">
      <div class="container">
        <h2>Conferindo seu pagamento</h2>
        <p>Estamos aguardando a confirmação segura do Mercado Pago.</p>
      </div>
    </section>`);
  document.querySelector("main")?.prepend(banner);
  if (!orderId || !token) return;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    try {
      const response = await fetch(
        `/api/orders/${encodeURIComponent(orderId)}/status?token=${encodeURIComponent(token)}`,
        { cache: "no-store" }
      );
      if (!response.ok) break;
      const result = await response.json();
      if (result.status === "approved") {
        banner.querySelector("h2").textContent = "Pagamento confirmado!";
        banner.querySelector("p").textContent = result.emailStatus === "sent"
          ? `Sua reserva para ${result.excursionTitle} está confirmada. Enviamos os detalhes por e-mail.`
          : `Sua reserva para ${result.excursionTitle} está confirmada. O e-mail de confirmação será enviado em seguida.`;
        return;
      }
      if (result.status === "review_required") {
        banner.querySelector("h2").textContent = "Pagamento em conferência";
        banner.querySelector("p").textContent = "A equipe precisa conferir esta reserva. Entre em contato com a Fui Lá Excursões.";
        return;
      }
      if (["rejected", "cancelled", "expired"].includes(result.status)) {
        banner.querySelector("h2").textContent = "Pagamento não concluído";
        banner.querySelector("p").textContent = "A reserva não foi confirmada. Você pode tentar novamente.";
        return;
      }
      if (attempt < 4) await new Promise((resolve) => setTimeout(resolve, 1800));
    } catch {
      break;
    }
  }
}
showPaymentReturn();

/* ============================================
   CONTACT FORM
   ============================================ */
document.getElementById("contact-form").addEventListener("submit", (e) => {
  e.preventDefault();
  const form = e.currentTarget;
  const btn = form.querySelector('button[type="submit"]');
  const txt = btn.querySelector(".btn-text");
  const ld = btn.querySelector(".btn-loading");
  txt.classList.add("hidden");
  ld.classList.remove("hidden");
  btn.disabled = true;

  const data = new FormData(form);
  const message = [
    `Olá! Acabei de enviar uma mensagem pelo site:`,
    ``,
    `Nome: ${data.get("name") || ""}`,
    `Telefone: ${data.get("phone") || ""}`,
    `E-mail: ${data.get("email") || ""}`,
    `Destino: ${data.get("subject") || ""}`,
    ``,
    `Mensagem:`,
    `${data.get("message") || ""}`,
  ].join("\n");

  setTimeout(() => {
    txt.classList.remove("hidden");
    ld.classList.add("hidden");
    btn.disabled = false;
    form.reset();
    toast({
      title: "Mensagem enviada!",
      description: "Recebemos seu contato. Em breve nossa equipe responderá pelo seu e-mail ou WhatsApp."
    });
    window.open(whatsappLink(message), "_blank", "noopener");
  }, 1200);
});

/* ============================================
   ESC TO CLOSE MODALS
   ============================================ */
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (searchModal.classList.contains("open")) closeSearch();
    if (checkoutModal.classList.contains("open")) closeCheckout();
  }
});
