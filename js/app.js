(() => {
  "use strict";

  const config = window.CHISTO_CONFIG && typeof window.CHISTO_CONFIG === "object" ? window.CHISTO_CONFIG : {};
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];

  function validateCatalog(value) {
    const empty = { items: [], services: Object.create(null), maxQuantity: 0, calculatorAvailable: false };
    const record = (entry) => entry !== null && typeof entry === "object" && !Array.isArray(entry);
    const text = (entry) => typeof entry === "string" && entry.trim().length > 0;
    const identifier = (entry) => typeof entry === "string" && /^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(entry) &&
      !["constructor", "prototype"].includes(entry);
    const price = (entry) => Number.isSafeInteger(entry) && entry > 0;
    const localImage = (entry) => {
      if (!text(entry)) return false;
      try {
        const url = new URL(entry, document.baseURI);
        return ["http:", "https:", "file:"].includes(url.protocol) && url.origin === location.origin && !url.username && !url.password;
      } catch { return false; }
    };

    try {
      if (!record(value) || !record(value.services)) return empty;
      const services = Object.create(null);
      const entries = Object.entries(value.services);
      let servicesValid = entries.length > 0;
      entries.forEach(([id, service]) => {
        const valid = identifier(id) && record(service) && /^\d{2}$/.test(service.number) &&
          text(service.name) && text(service.description) && localImage(service.image) && text(service.imageAlt) &&
          Number.isSafeInteger(service.imageWidth) && service.imageWidth > 0 && Number.isSafeInteger(service.imageHeight) && service.imageHeight > 0 &&
          price(service.price) && Array.isArray(service.details) && service.details.length > 0 && service.details.every(text);
        if (!valid) { servicesValid = false; return; }
        services[id] = {
          number: service.number, name: service.name, description: service.description,
          image: service.image, imageAlt: service.imageAlt, imageWidth: service.imageWidth, imageHeight: service.imageHeight,
          price: service.price, details: [...service.details],
        };
      });
      const seen = new Set();
      const validItems = servicesValid && Array.isArray(value.items) && value.items.length > 0 &&
        Number.isSafeInteger(value.maxQuantity) && value.maxQuantity > 0 && value.maxQuantity <= 20 &&
        value.items.every((item) => {
          if (!record(item) || !identifier(item.id) || seen.has(item.id) || !text(item.name) || !price(item.price) || !identifier(item.category) ||
            !Object.prototype.hasOwnProperty.call(services, item.category) ||
            (item.popular !== undefined && typeof item.popular !== "boolean")) return false;
          seen.add(item.id);
          return true;
        }) && Number.isSafeInteger(value.items.reduce((total, item) => total + item.price * value.maxQuantity, 0));
      return {
        services, calculatorAvailable: validItems, maxQuantity: validItems ? value.maxQuantity : 0,
        items: validItems ? value.items.map((item) => ({
          id: item.id, name: item.name, price: item.price, category: item.category, popular: !!item.popular,
        })) : [],
      };
    } catch { return empty; }
  }

  // Only validated, copied data reaches the calculator or service dialogs.
  const catalog = validateCatalog(window.CHISTO_CATALOG);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  const mobileViewport = window.matchMedia("(max-width: 760px)");
  const hasIntersectionObserver = typeof window.IntersectionObserver === "function";
  const money = new Intl.NumberFormat("ru-RU", {
    style: "currency", currency: "RUB", maximumFractionDigits: 0,
  });
  const formatMoney = (amount) => money.format(amount);
  const quantities = new Map(catalog.items.map((item) => [item.id, 0]));
  const dialogOpeners = new WeakMap();
  const dialogDestinations = new WeakMap();
  const fieldErrors = {
    name: "name-error", phone: "phone-error", service: "service-error", consent: "consent-error",
  };
  let toastTimer;
  let calculatorReady = false;
  let heroPassed = false;
  let requestVisible = false;
  const hero = $(".hero");
  const request = $("#request");

  function announce(message) {
    const toast = $("#toast");
    if (!toast) return;
    window.clearTimeout(toastTimer);
    toast.textContent = message;
    toast.classList.add("is-visible");
    toastTimer = window.setTimeout(() => toast.classList.remove("is-visible"), 5000);
  }

  function scrollToSection(id, focus = false) {
    const target = document.getElementById(id);
    if (!target) return;
    target.scrollIntoView({ behavior: reducedMotion.matches ? "instant" : "smooth", block: "start" });
    if (focus) {
      const field = id === "request" ? $("#customer-name") : target;
      if (field && !field.hasAttribute("tabindex") && !field.matches("input, select, textarea, button, a")) {
        field.setAttribute("tabindex", "-1");
      }
      field?.focus({ preventScroll: true });
    }
  }

  function updateStickyAction() {
    const bar = $("#mobile-cta");
    if (!bar) return;
    bar.hidden = !mobileViewport.matches;
    const formFocused = !!document.activeElement?.closest("#request-form");
    const visible = mobileViewport.matches && heroPassed && !requestVisible && !formFocused && !$("dialog[open]");
    bar.classList.toggle("is-visible", visible);
    // Offscreen controls must not stay in the keyboard or accessibility tree.
    bar.inert = !visible;
  }

  function updateStickyFromScroll() {
    heroPassed = !!hero && hero.getBoundingClientRect().bottom < 90;
    const rect = request?.getBoundingClientRect();
    requestVisible = !!rect && rect.top < window.innerHeight && rect.bottom > 80;
    updateStickyAction();
  }

  function syncDialogState() {
    document.body.classList.toggle("dialog-open", !!$("dialog[open]"));
    $(".menu-toggle")?.setAttribute("aria-expanded", String(!!$("#mobile-menu")?.open));
    updateStickyAction();
  }

  function closeDialog(dialog, destination) {
    if (!dialog?.open) return;
    if (destination) dialogDestinations.set(dialog, destination);
    dialog.close();
    syncDialogState();
  }

  function openDialog(dialog, opener) {
    if (typeof dialog?.showModal !== "function") return false;
    if (dialog.open) return true;
    $$("dialog[open]").forEach((other) => {
      dialogOpeners.delete(other);
      dialogDestinations.delete(other);
      closeDialog(other);
    });
    dialogDestinations.delete(dialog);
    dialogOpeners.set(dialog, opener || document.activeElement);
    dialog.showModal();
    syncDialogState();
    return true;
  }

  $$("dialog").forEach((dialog) => {
    dialog.addEventListener("keydown", (event) => {
      if (event.key !== "Tab" || event.ctrlKey || event.metaKey || event.altKey) return;
      // Keep boundary navigation predictable, including Chromium's chrome-focus stop.
      const controls = $$("a[href], button, input, select, textarea, [tabindex]", dialog).filter((control) =>
        !control.matches(":disabled") && control.tabIndex >= 0 &&
        !control.closest("[hidden], [inert]") && control.getClientRects().length > 0
      );
      const first = controls[0];
      const last = controls.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === dialog)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (document.activeElement === last || document.activeElement === dialog)) {
        event.preventDefault();
        first.focus();
      }
    });
    dialog.addEventListener("close", () => {
      syncDialogState();
      // A queued close event must not steal focus from a newly opened modal.
      if (dialog.open) return;
      const destination = dialogDestinations.get(dialog) || dialogOpeners.get(dialog);
      dialogOpeners.delete(dialog);
      dialogDestinations.delete(dialog);
      if (!$("dialog[open]") && destination?.isConnected && !destination.matches(":disabled") && destination.getClientRects().length) {
        if (!destination.matches("a[href], button, input, select, textarea, [tabindex]")) destination.setAttribute("tabindex", "-1");
        destination.focus({ preventScroll: true });
      }
    });
    dialog.addEventListener("cancel", (event) => { event.preventDefault(); closeDialog(dialog); });
    dialog.addEventListener("click", (event) => {
      if (event.target !== dialog) return;
      const rect = dialog.getBoundingClientRect();
      if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) closeDialog(dialog);
    });
  });

  const menuToggle = $(".menu-toggle");
  const mobileMenu = $("#mobile-menu");
  if (menuToggle && typeof mobileMenu?.showModal === "function") {
    document.documentElement.classList.add("has-js");
    menuToggle.hidden = false;
    menuToggle.addEventListener("click", () => openDialog(mobileMenu, menuToggle));
  }
  mobileViewport.addEventListener("change", () => {
    if (!mobileViewport.matches && mobileMenu?.open) closeDialog(mobileMenu, $(".brand"));
    updateStickyAction();
  });

  function selectedItems() {
    return catalog.items.filter((item) => quantities.get(item.id) > 0).map((item) => ({
      ...item, quantity: quantities.get(item.id),
    }));
  }

  function estimateTotal(items = selectedItems()) {
    return items.reduce((total, item) => total + item.price * item.quantity, 0);
  }

  function selectService(value, suggested = false) {
    const select = $("#customer-service");
    if (!select || ![...select.options].some((option) => option.value === value)) return;
    select.value = value;
    select.dataset.suggested = String(suggested);
    clearFieldError(select);
    select.dispatchEvent(new Event("input", { bubbles: true }));
  }

  function renderEstimate() {
    const totalOutput = $("#estimate-total");
    if (!calculatorReady || !totalOutput) return;
    const items = selectedItems();
    const total = estimateTotal(items);
    const quantity = items.reduce((count, item) => count + item.quantity, 0);
    const formatted = formatMoney(total);
    totalOutput.textContent = formatted;
    $("#estimate-count").textContent = quantity ? `В расчёте: ${quantity} ед. · ${items.length} поз.` : "Пока не выбрано ни одной вещи";
    $("#estimate-empty").hidden = !!quantity;
    $("#estimate-reset").hidden = !quantity;
    $("#estimate-order").setAttribute("aria-disabled", String(!quantity));

    const list = $("#estimate-items");
    list.replaceChildren();
    list.hidden = !quantity;
    items.forEach((item) => {
      const row = document.createElement("li");
      const label = document.createElement("span");
      const price = document.createElement("span");
      label.textContent = `${item.name} × ${item.quantity}`;
      price.textContent = formatMoney(item.price * item.quantity);
      row.append(label, price);
      list.append(row);
    });

    const formEstimate = $("#form-estimate");
    if (formEstimate) {
      formEstimate.hidden = !quantity;
      $("#form-estimate-items").textContent = items.map((item) => `${item.name} × ${item.quantity}`).join("; ");
      $("#form-estimate-total").textContent = `Ориентировочно: ${formatted}`;
      const service = $("#customer-service");
      if (service && (!service.value || service.dataset.suggested === "true")) {
        const categories = [...new Set(items.map((item) => item.category))];
        selectService(categories.length > 1 ? "complex" : (categories[0] || ""), true);
      }
    }

    const badge = $("#mobile-cart-count");
    if (badge) { badge.hidden = !quantity; badge.textContent = quantity; }
    $("#estimate-announcement").textContent = quantity ? `В расчёте ${quantity} единиц. Предварительная сумма ${formatted}. Цены демонстрационные.` : "Расчёт пуст. Выберите вещи в прайсе.";
  }

  function updateQuantity(itemId, delta) {
    if (!calculatorReady || !Number.isInteger(delta)) return;
    const current = quantities.get(itemId);
    if (current === undefined) return;
    const next = Math.max(0, Math.min(catalog.maxQuantity, current + delta));
    quantities.set(itemId, next);
    const row = $(`tr[data-item="${itemId}"]`);
    if (row) {
      $("output", row).textContent = next;
      $("[data-quantity='-1']", row).disabled = next === 0;
      $("[data-quantity='1']", row).disabled = next === catalog.maxQuantity;
      row.classList.toggle("is-selected", next > 0);
    }
    renderEstimate();
  }

  function applyFilter(filter) {
    if (!calculatorReady || !$$("[data-filter]").some((button) => button.dataset.filter === filter)) return;
    catalog.items.forEach((item) => {
      const visible = filter === "all" || (filter === "popular" && item.popular) ||
        item.category === filter || (filter === "everyday" && item.category === "delicate");
      const row = $(`tr[data-item="${item.id}"]`);
      if (row) row.hidden = !visible;
    });
    $$("[data-filter]").forEach((button) => button.setAttribute("aria-pressed", String(button.dataset.filter === filter)));
  }

  function setCalculatorBusy(busy) {
    if (!calculatorReady) return;
    catalog.items.forEach((item) => {
      const row = $(`tr[data-item="${item.id}"]`);
      $("[data-quantity='-1']", row).disabled = busy || quantities.get(item.id) === 0;
      $("[data-quantity='1']", row).disabled = busy || quantities.get(item.id) === catalog.maxQuantity;
    });
    $("#estimate-reset").disabled = busy;
  }

  const priceRows = $("#price-rows");
  const calculatorSelectors = [".price-filters", ".quantity-limit", "#estimate-total", "#estimate-count", "#estimate-empty", "#estimate-reset", "#estimate-order", "#estimate-items", "#estimate-announcement"];
  calculatorReady = catalog.calculatorAvailable && !!priceRows && calculatorSelectors.every((selector) => !!$(selector)) &&
    $$("tr", priceRows).length === catalog.items.length && catalog.items.every((item) =>
      !!$(`tr[data-item="${item.id}"] .quantity-cell`, priceRows) && !!$(`tr[data-item="${item.id}"] td:nth-child(2)`, priceRows));
  if (calculatorReady) {
    catalog.items.forEach((item) => {
      const cell = $(`tr[data-item="${item.id}"] .quantity-cell`);
      if (!cell) return;
      $(`tr[data-item="${item.id}"] td:nth-child(2)`).textContent = formatMoney(item.price);
      const control = document.createElement("div");
      control.className = "quantity-control";
      const minus = document.createElement("button");
      minus.type = "button";
      minus.dataset.quantity = "-1";
      minus.textContent = "−";
      minus.disabled = true;
      minus.setAttribute("aria-label", `Уменьшить количество: ${item.name}`);
      const quantity = document.createElement("output");
      quantity.textContent = "0";
      quantity.setAttribute("aria-label", `Количество: ${item.name}`);
      const plus = document.createElement("button");
      plus.type = "button";
      plus.dataset.quantity = "1";
      plus.textContent = "+";
      plus.setAttribute("aria-label", `Добавить: ${item.name}`);
      control.append(minus, quantity, plus);
      cell.append(control);
    });
    $(".price-filters").hidden = false;
    $(".quantity-limit").hidden = false;
    applyFilter("popular");
    renderEstimate();
    priceRows.addEventListener("click", (event) => {
      const button = event.target.closest("button[data-quantity]");
      if (!button || button.disabled) return;
      updateQuantity(button.closest("tr").dataset.item, Number(button.dataset.quantity));
    });
    $(".price-filters").addEventListener("click", (event) => {
      const button = event.target.closest("[data-filter]");
      if (button) applyFilter(button.dataset.filter);
    });
    $("#estimate-reset").addEventListener("click", () => {
      catalog.items.forEach((item) => updateQuantity(item.id, -(quantities.get(item.id) || 0)));
      announce("Расчёт очищен. Можно выбрать другие вещи.");
    });
    $("#estimate-order").addEventListener("click", (event) => {
      if (!selectedItems().length) {
        event.preventDefault();
        announce("Сначала добавьте вещь в расчёт — нажмите «+» в прайсе.");
        return;
      }
      event.preventDefault();
      const categories = [...new Set(selectedItems().map((item) => item.category))];
      selectService(categories.length > 1 ? "complex" : categories[0], true);
      scrollToSection("request", true);
    });
    $("#edit-estimate")?.addEventListener("click", () => scrollToSection("prices", true));
  } else if (priceRows) {
    const total = $("#estimate-total");
    if (total) { total.textContent = "—"; total.setAttribute("aria-label", "Расчёт недоступен"); }
    const message = "Калькулятор временно недоступен: данные прайса не загрузились или некорректны.";
    const count = $("#estimate-count");
    if (count) count.textContent = message;
    const empty = $("#estimate-empty");
    if (empty) empty.textContent = "Ниже доступен примерный прайс. Можно перейти к форме и выбрать направление ухода без расчёта.";
    $("#estimate-order")?.removeAttribute("aria-disabled");
    const announcement = $("#estimate-announcement");
    if (announcement) announcement.textContent = message;
  }

  function showService(id, opener) {
    const service = catalog.services[id];
    const dialog = $("#service-dialog");
    if (!service || !dialog) return false;
    $("#service-dialog-eyebrow").textContent = `${service.number} / Направление ухода`;
    $("#service-dialog-title").textContent = service.name;
    $("#service-dialog-description").textContent = service.description;
    const image = $("#service-dialog-image");
    image.src = service.image;
    image.alt = service.imageAlt;
    image.width = service.imageWidth;
    image.height = service.imageHeight;
    const details = $("#service-dialog-details");
    details.replaceChildren();
    service.details.forEach((text) => {
      const li = document.createElement("li");
      li.textContent = text;
      details.append(li);
    });
    $("#service-dialog-price").textContent = formatMoney(service.price);
    $("#service-dialog-order").dataset.selectService = id;
    $("#service-dialog-page").href = `services.html#${id}`;
    return openDialog(dialog, opener);
  }

  const range = $("#comparison-range");
  if (range) range.disabled = false;
  range?.addEventListener("input", () => {
    const split = Math.max(0, Math.min(100, Number(range.value)));
    $("#comparison-stage").style.setProperty("--split", `${split}%`);
    range.setAttribute("aria-valuetext", `${split}% изображения «До»`);
  });

  function verifiedContactUrl(channel) {
    if (channel === "phone") {
      const phone = normalizePhone(config.phone);
      return phone ? `tel:${phone}` : "";
    }
    if (!["telegram", "whatsapp"].includes(channel)) return "";
    const raw = channel === "telegram" ? config.telegramUrl : config.whatsappUrl;
    if (!raw) return "";
    try {
      const url = new URL(raw);
      const allowedHosts = channel === "telegram" ? ["t.me", "telegram.me"] : ["wa.me", "api.whatsapp.com"];
      return url.protocol === "https:" && allowedHosts.includes(url.hostname) && !url.username && !url.password && !url.port ? url.href : "";
    } catch { return ""; }
  }

  $$("[data-contact]").forEach((link) => {
    const channel = link.dataset.contact;
    const url = verifiedContactUrl(channel);
    if (!url) return;
    link.href = url;
    if (channel === "phone") {
      link.textContent = config.phoneLabel || formatPhone(normalizePhone(config.phone));
      const label = link.parentElement.querySelector(".contact-label");
      if (label) label.textContent = "Телефон";
    } else {
      link.target = "_blank";
      link.rel = "noopener noreferrer";
    }
  });

  document.addEventListener("click", (event) => {
    const close = event.target.closest("[data-dialog-close]");
    if (close) { closeDialog(close.closest("dialog")); return; }
    const serviceLink = event.target.closest("a[data-service]");
    if (serviceLink && !event.ctrlKey && !event.metaKey && !event.shiftKey && event.button === 0) {
      if (showService(serviceLink.dataset.service, serviceLink)) event.preventDefault();
      return;
    }
    const contactLink = event.target.closest("[data-contact]");
    if (contactLink && !verifiedContactUrl(contactLink.dataset.contact)) {
      const dialog = $("#contact-dialog");
      if (dialog && openDialog(dialog, contactLink)) event.preventDefault();
      return;
    }
    const selectLink = event.target.closest("[data-select-service]");
    if (selectLink && $("#customer-service")) {
      selectService(selectLink.dataset.selectService);
    }
    const menuLink = event.target.closest("#mobile-menu a, [data-close-on-link], [data-select-service]");
    if (menuLink && !event.ctrlKey && !event.metaKey && !event.shiftKey && !event.altKey && event.button === 0) {
      const dialog = menuLink.closest("dialog[open]");
      const targetUrl = new URL(menuLink.href, location.href);
      const samePage = targetUrl.origin === location.origin && targetUrl.pathname === location.pathname && targetUrl.search === location.search;
      const target = samePage && targetUrl.hash ? document.getElementById(decodeURIComponent(targetUrl.hash.slice(1))) : null;
      closeDialog(dialog, target?.id === "request" ? $("#customer-name") : target);
    }
  });

  function clearFieldError(field) {
    if (!field) return;
    field.removeAttribute("aria-invalid");
    const error = document.getElementById(fieldErrors[field.name]);
    if (error) error.textContent = "";
  }

  function setFieldError(field, message) {
    field.setAttribute("aria-invalid", "true");
    const error = document.getElementById(fieldErrors[field.name]);
    if (error) error.textContent = message;
  }

  function normalizePhone(value) {
    if (typeof value !== "string") return "";
    const raw = value.trim();
    if (!/^\+?[\d\s()\-]+$/.test(raw)) return "";
    let digits = raw.replace(/\D/g, "");
    if (raw.startsWith("+") && (digits.length !== 11 || digits[0] !== "7")) return "";
    if (digits.length === 10 && /^[2-9]/.test(digits)) digits = `7${digits}`;
    if (digits.length === 11 && digits[0] === "8") digits = `7${digits.slice(1)}`;
    return /^7[2-9]\d{9}$/.test(digits) ? `+${digits}` : "";
  }

  function formatPhone(phone) {
    const digits = phone.slice(2);
    return `+7 (${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6, 8)}-${digits.slice(8, 10)}`;
  }

  function validationMessage(field) {
    if (field.name === "name") return /^[\p{L}\p{M}][\p{L}\p{M}\s'’-]{1,59}$/u.test(field.value.trim()) ? "" : "Укажите имя: от 2 до 60 букв.";
    if (field.name === "phone") return normalizePhone(field.value.trim()) ? "" : "Укажите российский номер, например +7 (999) 123-45-67.";
    if (field.name === "service") return field.value ? "" : "Выберите направление или консультацию.";
    if (field.name === "consent") return field.checked ? "" : "Для проверки заявки необходимо согласие.";
    return "";
  }

  function formStatus(message, error = false) {
    const status = $("#form-status");
    if (!status) return;
    status.hidden = !message;
    status.textContent = message;
    status.classList.toggle("is-error", error);
  }

  const form = $("#request-form");
  if (form) {
    form.noValidate = true;
    const submit = $("[type='submit']", form);
    submit.disabled = false;
    const submitLabel = $("span", submit);
    const fields = ["name", "phone", "service", "consent"].map((name) => form.elements.namedItem(name));
    const consent = form.elements.namedItem("consent");
    let consentConfirmedAt = "";
    let formStartedAt = new Date().toISOString();
    let requestId = "";
    let requestSignature = "";
    let submitting = false;
    const observeConsent = () => {
      consentConfirmedAt = consent.checked ? (consentConfirmedAt || new Date().toISOString()) : "";
    };
    consent.addEventListener("input", observeConsent);
    consent.addEventListener("change", observeConsent);
    form.addEventListener("reset", () => {
      consentConfirmedAt = "";
      formStartedAt = new Date().toISOString();
    });

    if (config.endpoint) {
      $("#form-mode-note").textContent = config.mock ? "Локальный тест: уведомления Telegram моделируются, реальные заявки не отправляются." :
        "Поля с * обязательны. Стоимость и возможность ухода уточняются после осмотра.";
      $(".request-form__heading > span").textContent = config.mock ? "Локальный тест" : "Заявка на уход";
    }

    fields.forEach((field) => {
      field.addEventListener("blur", () => {
        if (field.name === "consent" || (!field.value && !field.hasAttribute("aria-invalid"))) return;
        const message = validationMessage(field);
        if (message) setFieldError(field, message); else clearFieldError(field);
      });
      field.addEventListener("input", () => {
        if (!validationMessage(field)) clearFieldError(field);
        formStatus("");
      });
    });
    $("#customer-service").addEventListener("change", (event) => { event.target.dataset.suggested = "false"; });
    $("#customer-comment").addEventListener("input", () => formStatus(""));
    $("#customer-phone").addEventListener("blur", (event) => {
      const phone = normalizePhone(event.target.value.trim());
      if (phone) event.target.value = formatPhone(phone);
    });
    const initialService = new URLSearchParams(window.location.search).get("service");
    if (initialService) selectService(initialService);

    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      if (submitting || submit.disabled) return;
      let firstInvalid = null;
      fields.forEach((field) => {
        const message = validationMessage(field);
        if (message) { setFieldError(field, message); firstInvalid ||= field; }
        else clearFieldError(field);
      });
      if (firstInvalid) {
        formStatus("Проверьте отмеченные поля — заявка не отправлена.", true);
        firstInvalid.focus();
        return;
      }
      if (!config.endpoint) {
        formStatus("Форма заполнена корректно. Это демонстрация: заявка НЕ отправлена. Данные никуда не переданы и не сохранены.");
        return;
      }

      // Project/recipient/catalog are selected on the server, never by this browser.
      let endpoint;
      try {
        endpoint = new URL(config.endpoint, window.location.href);
        if (endpoint.origin !== window.location.origin || !/^https?:$/.test(endpoint.protocol) || endpoint.username || endpoint.password) throw new Error("Invalid endpoint");
      } catch {
        formStatus("Отправка не настроена: адрес сервера должен быть на домене сайта. Данные не отправлены.", true);
        return;
      }

      if (typeof config.consentVersion !== "string" || !config.consentVersion.trim()) {
        formStatus("Отправка не настроена: не указана версия согласия. Данные не отправлены.", true);
        return;
      }
      if (typeof config.projectId !== "string" || !/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/.test(config.projectId) || config.projectId.length > 64) {
        formStatus("Отправка не настроена: не указан идентификатор проекта. Данные не отправлены.", true);
        return;
      }
      if (typeof window.fetch !== "function" || typeof window.AbortController !== "function" || typeof window.crypto?.randomUUID !== "function") {
        formStatus("Браузер не поддерживает безопасную отправку формы. Данные не отправлены.", true);
        return;
      }
      // This is an untrusted client timestamp, not legal proof or the server's receipt time.
      observeConsent();

      const items = selectedItems();
      const payload = {
        projectId: config.projectId,
        name: form.elements.name.value.trim(),
        phone: normalizePhone(form.elements.phone.value.trim()),
        service: form.elements.service.value,
        comment: form.elements.comment.value.trim().slice(0, 1000),
        consent: true,
        consentVersion: config.consentVersion.trim(),
        consentConfirmedAt,
        formStartedAt,
        website: form.elements.namedItem("website")?.value || "",
        items: items.map((item) => ({ id: item.id, quantity: item.quantity, unitPrice: item.price })),
        estimate: estimateTotal(items),
        currency: config.currency || "RUB",
        source: "chisto-website",
      };
      // Reuse the same UUID after a timeout, lost response or a retryable server error.
      // A changed logical form gets a new UUID. Nothing is persisted in the browser.
      const signature = JSON.stringify(payload);
      if (!requestId || signature !== requestSignature) {
        requestId = window.crypto.randomUUID();
        requestSignature = signature;
      }
      payload.requestId = requestId;
      let controller;
      let timeout;
      const disabledStates = new Map($$("input, select, textarea", form).map((control) => [control, control.disabled]));
      submitting = true;
      submit.disabled = true;
      disabledStates.forEach((disabled, control) => { control.disabled = true; });
      setCalculatorBusy(true);
      form.setAttribute("aria-busy", "true");
      submitLabel.textContent = "Отправляем…";
      formStatus("Отправляем заявку на сервер…");
      try {
        controller = new AbortController();
        timeout = window.setTimeout(() => controller.abort(), 12000);
        const response = await fetch(endpoint.href, {
          method: "POST", credentials: "same-origin", redirect: "error", signal: controller.signal,
          headers: { "Content-Type": "application/json", Accept: "application/json" },
          body: JSON.stringify(payload),
        });
        const contentType = response.headers.get("Content-Type") || "";
        if (!/^application\/(?:json|[a-z0-9!#$&^_.+-]+\+json)(?:\s*;|\s*$)/i.test(contentType)) throw new Error("Invalid JSON response");
        const result = await response.json();
        if (!response.ok || !result || result.accepted !== true) {
          const failure = new Error("Not accepted");
          if (/^[A-Z_]{1,64}$/.test(result?.code || "")) failure.code = result.code;
          failure.retryAfter = Number.isSafeInteger(result?.retryAfter) && result.retryAfter > 0 && result.retryAfter <= 86400 ? result.retryAfter : 0;
          throw failure;
        }
        requestId = "";
        requestSignature = "";
        form.reset();
        catalog.items.forEach((item) => updateQuantity(item.id, -(quantities.get(item.id) || 0)));
        formStatus(config.mock ? "Тестовый сервер подтвердил приём. Telegram смоделирован: реальные заявки и уведомления не отправлялись." :
          "Сервер подтвердил приём заявки. Сроки, стоимость и возможность ухода будут согласованы отдельно.");
      } catch (error) {
        const prefix = controller?.signal.aborted ? "Время ожидания ответа истекло. " : "";
        const explanations = {
          VALIDATION_ERROR: "Проверьте поля, согласие и выбранные услуги. Если цены изменились, обновите страницу после проверки статуса заявки.",
          RATE_LIMITED: `Слишком много попыток.${error.retryAfter ? ` Подождите ${error.retryAfter} сек.` : " Попробуйте позже."}`,
          REQUEST_IN_PROGRESS: "Заявка ещё обрабатывается. Повтор без изменения полей сохранит её идентификатор.",
          DELIVERY_UNAVAILABLE: `Канал уведомлений временно недоступен.${error.retryAfter ? ` Повторите не раньше чем через ${error.retryAfter} сек.` : " Попробуйте позже."}`,
          DELIVERY_UNCERTAIN: "Уведомление могло уже уйти. Не создавайте новую заявку; уточните статус через подключённые контакты.",
          PROJECT_MISMATCH: "Настройки проекта не совпадают. Обратитесь к владельцу сайта.",
          RECIPIENT_CHANGED: "Получатель изменился. Владелец сайта должен проверить статус заявки.",
          REQUESTS_DISABLED: "Приём заявок на сервере отключён.",
          IDEMPOTENCY_CONFLICT: "Идентификатор заявки уже связан с другими данными. Уточните статус через контакты.",
          REQUEST_EXPIRED: "Срок повторной проверки истёк. Сначала уточните статус через контакты.",
        };
        const explanation = explanations[error.code] || "Перед повторной отправкой уточните приём через подключённые контакты.";
        formStatus(`${prefix}Не удалось подтвердить приём заявки. ${explanation} Данные и расчёт сохранены только до закрытия страницы.`, true);
      } finally {
        window.clearTimeout(timeout);
        submitting = false;
        submit.disabled = false;
        disabledStates.forEach((disabled, control) => { control.disabled = disabled; });
        setCalculatorBusy(false);
        form.removeAttribute("aria-busy");
        submitLabel.textContent = "Оставить заявку";
      }
    });
  }

  const header = $(".site-header");
  let scrollScheduled = false;
  function updateHeader() {
    header?.classList.toggle("is-scrolled", window.scrollY > 20);
    if (!hasIntersectionObserver) updateStickyFromScroll();
    scrollScheduled = false;
  }
  function scheduleScrollUpdate() {
    if (!scrollScheduled) { scrollScheduled = true; window.requestAnimationFrame(updateHeader); }
  }
  window.addEventListener("scroll", scheduleScrollUpdate, { passive: true });
  window.addEventListener("resize", scheduleScrollUpdate, { passive: true });
  document.addEventListener("focusin", updateStickyAction);
  document.addEventListener("focusout", () => window.requestAnimationFrame(updateStickyAction));
  updateHeader();

  if (hasIntersectionObserver) {
    if (!reducedMotion.matches) {
      const revealObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          entry.target.classList.add("is-revealed");
          revealObserver.unobserve(entry.target);
        });
      }, { threshold: .05, rootMargin: "0px 0px -35px 0px" });
      $$("[data-reveal]").forEach((element) => {
        if (element.getBoundingClientRect().top > window.innerHeight - 40) element.classList.add("will-reveal");
        revealObserver.observe(element);
      });
    }

    if (hero && request) {
      new IntersectionObserver((entries) => {
        heroPassed = entries[0].boundingClientRect.bottom < 90;
        updateStickyAction();
      }, { rootMargin: "-90px 0px 0px 0px", threshold: 0 }).observe(hero);
      new IntersectionObserver((entries) => {
        requestVisible = entries[0].isIntersecting;
        updateStickyAction();
      }, { rootMargin: "-80px 0px 0px 0px", threshold: 0 }).observe(request);
    }

    const navLinks = $$(".desktop-nav a[href^='#']");
    const navObserver = new IntersectionObserver((entries) => {
      entries.forEach((entry) => {
        if (!entry.isIntersecting) return;
        navLinks.forEach((link) => link.classList.toggle("is-active", link.hash === `#${entry.target.id}`));
      });
    }, { rootMargin: "-20% 0px -60% 0px", threshold: 0 });
    navLinks.forEach((link) => { const section = document.getElementById(link.hash.slice(1)); if (section) navObserver.observe(section); });
  }
  updateStickyAction();
})();
