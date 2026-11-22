const $ = (selector) => document.querySelector(selector);
const $$ = (selector) => [...document.querySelectorAll(selector)];
const brl = (cents) => new Intl.NumberFormat("pt-BR", {
  style: "currency",
  currency: "BRL",
}).format(Number(cents || 0) / 100);
const escapeHtml = (value) => String(value ?? "").replace(/[&<>"']/g, (char) => ({
  "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#039;",
})[char]);
const dateLabel = (value) => {
  if (!value) return "—";
  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "medium",
    timeZone: "UTC",
  }).format(new Date(`${String(value).slice(0, 10)}T12:00:00Z`));
};

let excursions = [];
let coupons = [];
let buyerPage = 1;
let buyerHasMore = false;
let buyerSearch = "";

async function api(url, options = {}) {
  const response = await fetch(url, {
    credentials: "same-origin",
    cache: "no-store",
    ...options,
    headers: {
      ...(options.body instanceof FormData ? {} : { "Content-Type": "application/json" }),
      ...(options.headers || {}),
    },
  });
  const data = response.status === 204 ? null : await response.json().catch(() => null);
  if (response.status === 401 && !url.endsWith("/session") && !url.endsWith("/login")) {
    showLogin();
  }
  if (!response.ok) throw new Error(data?.error || "Não foi possível concluir a operação.");
  return data;
}

function notify(message, type = "success") {
  const toast = $("#toast");
  toast.textContent = message;
  toast.dataset.type = type;
  toast.classList.add("visible");
  window.clearTimeout(notify.timer);
  notify.timer = window.setTimeout(() => toast.classList.remove("visible"), 3600);
}

function showLogin(message = "") {
  $("#login-view").hidden = false;
  $("#dashboard-view").hidden = true;
  $("#staff-account").hidden = true;
  $("#login-message").textContent = message;
}

function showDashboard(email) {
  $("#login-view").hidden = true;
  $("#dashboard-view").hidden = false;
  $("#staff-account").hidden = false;
  $("#staff-email").textContent = email || "Equipe Fui Lá";
  setView("overview");
  loadOverview();
}

async function checkSession() {
  try {
    const session = await api("/api/auth/session");
    if (session.authenticated) showDashboard(session.email);
    else showLogin();
  } catch {
    showLogin("Não foi possível conectar ao servidor. Atualize a página e tente novamente.");
  }
}

$("#login-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const data = new FormData(event.currentTarget);
  button.disabled = true;
  $("#login-message").textContent = "";
  try {
    const session = await api("/api/auth/login", {
      method: "POST",
      body: JSON.stringify({
        email: data.get("email"),
        password: data.get("password"),
      }),
    });
    event.currentTarget.reset();
    showDashboard(session.email || "Equipe Fui Lá");
  } catch (error) {
    $("#login-message").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#logout-button").addEventListener("click", async () => {
  try {
    await api("/api/auth/logout", { method: "POST", body: "{}" });
  } finally {
    showLogin("Você saiu do painel.");
  }
});

function setView(name) {
  $$(".staff-tabs button").forEach((button) => {
    const active = button.dataset.view === name;
    button.classList.toggle("active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
  $$(".staff-page").forEach((page) => {
    page.hidden = page.dataset.page !== name;
  });
  if (name === "overview") loadOverview();
  if (name === "excursions") loadExcursions();
  if (name === "coupons") loadCoupons();
  if (name === "buyers") loadBuyers();
}

$$(".staff-tabs button").forEach((button) =>
  button.addEventListener("click", () => setView(button.dataset.view))
);

function drawChart(container, points, key, color, mode = "line") {
  container.replaceChildren();
  if (!points.length) {
    container.textContent = "Ainda não há dados para este período.";
    return;
  }
  const width = 760;
  const height = 230;
  const left = 42;
  const right = 12;
  const top = 12;
  const bottom = 34;
  const plotWidth = width - left - right;
  const plotHeight = height - top - bottom;
  const values = points.map((point) => Number(point[key] || 0));
  const maximum = Math.max(...values, 1);
  const svg = document.createElementNS("http://www.w3.org/2000/svg", "svg");
  svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
  svg.setAttribute("role", "img");
  const title = document.createElementNS(svg.namespaceURI, "title");
  title.textContent = key === "visits" ? "Visitas diárias ao site" : "Receita diária aprovada";
  svg.append(title);
  for (let line = 0; line <= 3; line += 1) {
    const y = top + (plotHeight * line) / 3;
    const grid = document.createElementNS(svg.namespaceURI, "line");
    grid.setAttribute("x1", left);
    grid.setAttribute("x2", width - right);
    grid.setAttribute("y1", y);
    grid.setAttribute("y2", y);
    grid.setAttribute("class", "chart-grid-line");
    svg.append(grid);
  }
  if (mode === "bars") {
    const step = plotWidth / points.length;
    points.forEach((point, index) => {
      const value = Number(point[key] || 0);
      const bar = document.createElementNS(svg.namespaceURI, "rect");
      const barHeight = (value / maximum) * plotHeight;
      bar.setAttribute("x", left + index * step + step * 0.2);
      bar.setAttribute("y", top + plotHeight - barHeight);
      bar.setAttribute("width", Math.max(2, step * 0.6));
      bar.setAttribute("height", Math.max(1, barHeight));
      bar.setAttribute("rx", "3");
      bar.setAttribute("fill", color);
      bar.setAttribute("class", "chart-bar");
      bar.setAttribute("aria-label", `${dateLabel(point.day)}: ${brl(value)}`);
      svg.append(bar);
    });
  } else {
    const step = points.length > 1 ? plotWidth / (points.length - 1) : plotWidth;
    const coordinates = points.map((point, index) => {
      const value = Number(point[key] || 0);
      return `${left + index * step},${top + plotHeight - (value / maximum) * plotHeight}`;
    }).join(" ");
    const line = document.createElementNS(svg.namespaceURI, "polyline");
    line.setAttribute("points", coordinates);
    line.setAttribute("fill", "none");
    line.setAttribute("stroke", color);
    line.setAttribute("stroke-width", "3");
    line.setAttribute("stroke-linecap", "round");
    line.setAttribute("stroke-linejoin", "round");
    svg.append(line);
  }
  [0, Math.floor((points.length - 1) / 2), points.length - 1]
    .filter((index, position, all) => all.indexOf(index) === position)
    .forEach((index) => {
      const label = document.createElementNS(svg.namespaceURI, "text");
      label.setAttribute("x", left + (points.length > 1 ? plotWidth * index / (points.length - 1) : plotWidth / 2));
      label.setAttribute("y", height - 8);
      label.setAttribute("text-anchor", "middle");
      label.setAttribute("class", "chart-axis-label");
      label.textContent = dateLabel(points[index].day);
      svg.append(label);
    });
  container.append(svg);
}

async function loadOverview() {
  try {
    const [data, config] = await Promise.all([
      api("/api/staff/overview"),
      api("/api/staff/config"),
    ]);
    const totals = data.totals;
    $("#overview-metrics").innerHTML = `
      <article class="metric-card"><span>Receita aprovada</span><strong>${brl(totals.revenue_cents)}</strong><small>Acumulado das reservas pagas</small></article>
      <article class="metric-card"><span>Reservas aprovadas</span><strong>${Number(totals.approved_orders || 0)}</strong><small>Pagamentos confirmados</small></article>
      <article class="metric-card"><span>Aguardando pagamento</span><strong>${Number(totals.pending_orders || 0)}</strong><small>Vagas temporariamente reservadas</small></article>
      <article class="metric-card metric-attention"><span>Precisam de revisão</span><strong>${Number(totals.review_orders || 0)}</strong><small>Verifique no Mercado Pago</small></article>`;
    drawChart($("#visitors-chart"), data.daily, "visits", "#1097a7");
    drawChart($("#payments-chart"), data.daily, "revenue_cents", "#f59e0b", "bars");
    const status = [
      ["Login da equipe", config.staff],
      ["Mercado Pago", config.mercadoPago && config.webhook && config.publicUrl],
      ["Criptografia dos compradores", config.piiEncryption],
      ["E-mail Resend", config.resend],
    ];
    $("#setup-status").innerHTML = `
      <div class="setup-heading"><strong>Configuração da loja</strong><span>Os pagamentos só são confirmados pelo aviso seguro do Mercado Pago.</span></div>
      <div class="setup-badges">${status.map(([label, ready]) =>
        `<span class="setup-badge ${ready ? "ready" : "missing"}"><i></i>${escapeHtml(label)}: ${ready ? "configurado" : "pendente"}</span>`
      ).join("")}</div>`;
  } catch (error) {
    notify(error.message, "error");
  }
}

$("#refresh-overview").addEventListener("click", loadOverview);

function renderExcursions() {
  const list = $("#excursion-list");
  if (!excursions.length) {
    list.innerHTML = `<div class="panel empty-state"><h3>Nenhuma excursão cadastrada</h3><p>Use o formulário para publicar o primeiro pacote.</p></div>`;
    return;
  }
  list.innerHTML = excursions.map((item) => {
    const spots = Number(item.available_seats);
    const stockLabel = spots === 0 ? "Esgotado" : spots <= 10 ? `${spots} ${spots === 1 ? "lugar" : "lugares"}` : `${spots} disponíveis`;
    const stockClass = spots === 0 ? "soldout" : spots <= 10 ? "limited" : "available";
    return `
      <article class="panel excursion-record">
        <img class="record-image" src="${escapeHtml(item.image_url)}" alt="" loading="lazy" />
        <div class="record-main">
          <div class="record-title-line"><h3>${escapeHtml(item.title)}</h3><span class="record-state ${item.is_published ? "published" : "draft"}">${item.is_published ? "Publicado" : "Rascunho"}</span></div>
          <p>${dateLabel(item.departure_date)} · ${brl(item.price_cents)} por pessoa · a partir de ${Number(item.min_age)} anos</p>
          <div class="record-meta"><span class="stock-pill ${stockClass}">${stockLabel}</span><span>${Number(item.seats_sold)} vendidos de ${Number(item.capacity)}</span>${item.installments_count ? `<span>Até ${Number(item.installments_count)} parcelas</span>` : ""}</div>
        </div>
        <div class="record-actions">
          <button class="button button-quiet" type="button" data-edit-excursion="${escapeHtml(item.id)}">Editar</button>
          <button class="button button-quiet" type="button" data-publish-excursion="${escapeHtml(item.id)}" data-published="${item.is_published}">${item.is_published ? "Despublicar" : "Publicar"}</button>
        </div>
      </article>`;
  }).join("");
  list.querySelectorAll("[data-edit-excursion]").forEach((button) => {
    button.addEventListener("click", () => editExcursion(button.dataset.editExcursion));
  });
  list.querySelectorAll("[data-publish-excursion]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/staff/excursions/${encodeURIComponent(button.dataset.publishExcursion)}/publish`, {
          method: "PATCH",
          body: JSON.stringify({ published: button.dataset.published !== "true" }),
        });
        notify("Visibilidade da excursão atualizada.");
        await loadExcursions();
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });
}

async function loadExcursions() {
  try {
    excursions = await api("/api/staff/excursions");
    renderExcursions();
  } catch (error) {
    notify(error.message, "error");
  }
}

function clearExcursionForm() {
  const form = $("#excursion-form");
  form.reset();
  $("#excursion-id").value = "";
  $("#excursion-published").checked = true;
  $("#installments-count").disabled = true;
  $("#installment-field").hidden = true;
  $("#excursion-preview").hidden = true;
  $("#excursion-preview").removeAttribute("src");
  $("#photo-required").hidden = false;
  $("#photo-hint").textContent = "JPG, PNG ou WebP, até 5 MB.";
  $("#excursion-form-title").textContent = "Nova excursão";
  $("#save-excursion").textContent = "Salvar excursão";
  $("#excursion-message").textContent = "";
}

function editExcursion(id) {
  const item = excursions.find((excursion) => excursion.id === id);
  if (!item) return;
  $("#excursion-id").value = item.id;
  $("#excursion-title").value = item.title;
  $("#excursion-description").value = item.description || "";
  $("#excursion-date").value = String(item.departure_date).slice(0, 10);
  $("#excursion-price").value = (item.price_cents / 100).toFixed(2);
  $("#excursion-age").value = item.min_age;
  $("#excursion-capacity").value = item.capacity;
  $("#installments-enabled").checked = Number(item.installments_count) > 0;
  $("#installment-field").hidden = !$("#installments-enabled").checked;
  $("#installments-count").disabled = !$("#installments-enabled").checked;
  if (item.installments_count) $("#installments-count").value = item.installments_count;
  $("#excursion-published").checked = item.is_published;
  $("#excursion-preview").src = item.image_url;
  $("#excursion-preview").hidden = false;
  $("#photo-required").hidden = true;
  $("#photo-hint").textContent = "Deixe vazio para manter a foto atual.";
  $("#excursion-form-title").textContent = "Editar excursão";
  $("#save-excursion").textContent = "Salvar alterações";
  $("#excursion-message").textContent = "";
  $("#excursion-form").scrollIntoView({ behavior: "smooth", block: "start" });
}

$("#installments-enabled").addEventListener("change", (event) => {
  $("#installment-field").hidden = !event.target.checked;
  $("#installments-count").disabled = !event.target.checked;
});
$("#excursion-photo").addEventListener("change", (event) => {
  const file = event.target.files?.[0];
  if (!file) return;
  $("#excursion-preview").src = URL.createObjectURL(file);
  $("#excursion-preview").hidden = false;
});
$("#cancel-excursion").addEventListener("click", clearExcursionForm);
$("#excursion-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const form = event.currentTarget;
  const id = $("#excursion-id").value;
  const button = $("#save-excursion");
  const photo = $("#excursion-photo").files?.[0];
  if (!id && !photo) {
    $("#excursion-message").textContent = "Escolha uma foto para o anúncio.";
    return;
  }
  button.disabled = true;
  $("#excursion-message").textContent = "Salvando...";
  try {
    const formData = new FormData(form);
    const response = await fetch(id ? `/api/staff/excursions/${encodeURIComponent(id)}` : "/api/staff/excursions", {
      method: id ? "PUT" : "POST",
      credentials: "same-origin",
      cache: "no-store",
      body: formData,
    });
    const data = await response.json().catch(() => null);
    if (!response.ok) throw new Error(data?.error || "Não foi possível salvar a excursão.");
    clearExcursionForm();
    notify(id ? "Excursão atualizada." : "Excursão criada.");
    await loadExcursions();
    setView("excursions");
  } catch (error) {
    $("#excursion-message").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});

$("#refresh-excursions").addEventListener("click", loadExcursions);

function renderCoupons() {
  const list = $("#coupon-list");
  if (!coupons.length) {
    list.innerHTML = `<div class="panel empty-state"><h3>Nenhum cupom criado</h3><p>Os cupons aparecerão aqui depois de salvos.</p></div>`;
    return;
  }
  list.innerHTML = coupons.map((coupon) => `
    <article class="panel coupon-record">
      <div>
        <div class="record-title-line"><h3>${escapeHtml(coupon.code)}</h3><span class="record-state ${coupon.is_active ? "published" : "draft"}">${coupon.is_active ? "Ativo" : "Desativado"}</span></div>
        <p>${coupon.discount_type === "percent" ? `${Number(coupon.discount_value)}% de desconto` : `${brl(coupon.discount_value)} de desconto`}</p>
        <small>${Number(coupon.used_count)} usados${coupon.max_uses ? ` de ${Number(coupon.max_uses)}` : ""}${coupon.expires_at ? ` · até ${dateLabel(coupon.expires_at)}` : ""}</small>
      </div>
      <button type="button" class="button button-quiet" data-toggle-coupon="${escapeHtml(coupon.id)}" data-active="${coupon.is_active}">${coupon.is_active ? "Desativar" : "Ativar"}</button>
    </article>`).join("");
  list.querySelectorAll("[data-toggle-coupon]").forEach((button) => {
    button.addEventListener("click", async () => {
      try {
        await api(`/api/staff/coupons/${encodeURIComponent(button.dataset.toggleCoupon)}`, {
          method: "PATCH",
          body: JSON.stringify({ active: button.dataset.active !== "true" }),
        });
        notify("Estado do cupom atualizado.");
        await loadCoupons();
      } catch (error) {
        notify(error.message, "error");
      }
    });
  });
}

async function loadCoupons() {
  try {
    coupons = await api("/api/staff/coupons");
    renderCoupons();
  } catch (error) {
    notify(error.message, "error");
  }
}

$("#coupon-type").addEventListener("change", (event) => {
  $("#coupon-value").step = event.target.value === "percent" ? "1" : "0.01";
  $("#coupon-value").max = event.target.value === "percent" ? "100" : "";
  $("#coupon-value").placeholder = event.target.value === "percent" ? "10" : "25,00";
});
$("#coupon-form").addEventListener("submit", async (event) => {
  event.preventDefault();
  const button = event.currentTarget.querySelector('button[type="submit"]');
  const values = Object.fromEntries(new FormData(event.currentTarget));
  button.disabled = true;
  $("#coupon-message").textContent = "Criando cupom...";
  try {
    await api("/api/staff/coupons", {
      method: "POST",
      body: JSON.stringify(values),
    });
    event.currentTarget.reset();
    $("#coupon-message").textContent = "";
    notify("Cupom criado.");
    await loadCoupons();
  } catch (error) {
    $("#coupon-message").textContent = error.message;
  } finally {
    button.disabled = false;
  }
});
$("#refresh-coupons").addEventListener("click", loadCoupons);

function statusLabel(status) {
  return ({
    pending: "Aguardando pagamento",
    approved: "Aprovado",
    rejected: "Recusado",
    cancelled: "Cancelado",
    expired: "Expirado",
    refunded: "Estornado",
    review_required: "Revisão necessária",
  })[status] || status;
}

function renderBuyers(data) {
  const list = $("#buyer-list");
  if (!data.buyers.length) {
    list.innerHTML = `<div class="panel empty-state"><h3>Nenhum comprador encontrado</h3><p>As compras concluídas aparecem aqui.</p></div>`;
    return;
  }
  list.innerHTML = data.buyers.map((buyer) => `
    <article class="panel buyer-record">
      <div class="buyer-heading">
        <div>
          <div class="record-title-line"><h3>${escapeHtml(buyer.excursionTitle)}</h3><span class="record-state ${buyer.status === "approved" ? "published" : buyer.status === "review_required" ? "attention" : "draft"}">${escapeHtml(statusLabel(buyer.status))}</span></div>
          <p>${dateLabel(buyer.departureDate)} · ${Number(buyer.seats)} ${Number(buyer.seats) === 1 ? "passageiro" : "passageiros"} · ${brl(buyer.totalCents)}</p>
        </div>
        <div class="buyer-tools">
          <span class="buyer-created">${new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short" }).format(new Date(buyer.createdAt))}</span>
          ${buyer.status === "approved" ? `<button type="button" class="button button-quiet" data-resend-email="${escapeHtml(buyer.id)}">${buyer.emailStatus === "sent" ? "Reenviar e-mail" : "Enviar confirmação"}</button>` : ""}
        </div>
      </div>
      <div class="buyer-contact"><span><strong>E-mail:</strong> ${escapeHtml(buyer.contactEmail)}</span><span><strong>Telefone:</strong> ${escapeHtml(buyer.contactPhone)}</span><span><strong>Pagamento:</strong> ${escapeHtml(buyer.paymentMethod || "—")}</span></div>
      <details class="buyer-details">
        <summary>Ver dados dos passageiros (${buyer.participants.length})</summary>
        <div class="passenger-list">${buyer.participants.map((person, index) => `
          <div class="passenger-data">
            <strong>${index + 1}. ${escapeHtml(`${person.firstName} ${person.lastName}`)}</strong>
            <span>CPF: ${escapeHtml(person.cpf)}</span>
            <span>Idade: ${Number(person.age)} anos</span>
            <span>E-mail: ${escapeHtml(person.email)}</span>
            <span>Telefone: ${escapeHtml(person.phone)}</span>
          </div>`).join("")}</div>
      </details>
      ${buyer.emailError ? `<p class="email-error">E-mail: ${escapeHtml(buyer.emailError)}</p>` : ""}
    </article>`).join("");
  list.querySelectorAll("[data-resend-email]").forEach((button) => {
    button.addEventListener("click", async () => {
      button.disabled = true;
      try {
        const result = await api(`/api/staff/orders/${encodeURIComponent(button.dataset.resendEmail)}/resend-email`, {
          method: "POST",
          body: "{}",
        });
        notify(result.sent ? "E-mail enviado." : "O envio do e-mail ainda está em andamento.");
        await loadBuyers();
      } catch (error) {
        notify(error.message, "error");
      } finally {
        button.disabled = false;
      }
    });
  });
}

async function loadBuyers() {
  const query = new URLSearchParams({ page: String(buyerPage) });
  if (buyerSearch) query.set("q", buyerSearch);
  try {
    const data = await api(`/api/staff/buyers?${query}`);
    buyerHasMore = data.hasMore;
    $("#buyers-page").textContent = `Página ${buyerPage}`;
    $("#buyers-prev").disabled = buyerPage <= 1;
    $("#buyers-next").disabled = !buyerHasMore;
    renderBuyers(data);
  } catch (error) {
    notify(error.message, "error");
  }
}

$("#buyer-search").addEventListener("submit", (event) => {
  event.preventDefault();
  buyerSearch = $("#buyer-query").value.trim();
  buyerPage = 1;
  loadBuyers();
});
$("#clear-buyer-search").addEventListener("click", () => {
  $("#buyer-query").value = "";
  buyerSearch = "";
  buyerPage = 1;
  loadBuyers();
});
$("#buyers-prev").addEventListener("click", () => {
  if (buyerPage > 1) {
    buyerPage -= 1;
    loadBuyers();
  }
});
$("#buyers-next").addEventListener("click", () => {
  if (buyerHasMore) {
    buyerPage += 1;
    loadBuyers();
  }
});
$("#refresh-buyers").addEventListener("click", loadBuyers);

checkSession();
