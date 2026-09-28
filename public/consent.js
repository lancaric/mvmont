(() => {
  const GTM_ID = 'GTM-KWTCJ8Q5';
  const GA_MEASUREMENT_ID = 'G-V99HLJGFBD';
  const STORAGE_KEY = 'mv_mont_cookie_consent_v1';

  const baseConsent = {
    ad_storage: 'denied',
    ad_user_data: 'denied',
    ad_personalization: 'denied',
    analytics_storage: 'denied',
    functionality_storage: 'granted',
    personalization_storage: 'denied',
    security_storage: 'granted'
  };

  window.dataLayer = window.dataLayer || [];
  window.gtag = window.gtag || function gtag() {
    window.dataLayer.push(arguments);
  };

  function normalizePreferences(preferences) {
    const analytics = Boolean(preferences && preferences.analytics);
    const marketing = Boolean(preferences && preferences.marketing);

    return {
      analytics,
      marketing,
      consent: {
        ad_storage: marketing ? 'granted' : 'denied',
        ad_user_data: marketing ? 'granted' : 'denied',
        ad_personalization: marketing ? 'granted' : 'denied',
        analytics_storage: analytics ? 'granted' : 'denied',
        functionality_storage: 'granted',
        personalization_storage: 'denied',
        security_storage: 'granted'
      }
    };
  }

  function readStoredConsent() {
    try {
      const rawValue = window.localStorage.getItem(STORAGE_KEY);
      if (!rawValue) return null;

      const parsedValue = JSON.parse(rawValue);
      return normalizePreferences(parsedValue);
    } catch (error) {
      console.warn('Cookie consent could not be restored.', error);
      return null;
    }
  }

  function persistConsent(preferences) {
    const normalized = normalizePreferences(preferences);

    try {
      window.localStorage.setItem(
        STORAGE_KEY,
        JSON.stringify({
          analytics: normalized.analytics,
          marketing: normalized.marketing,
          updatedAt: new Date().toISOString(),
          version: 1
        })
      );
    } catch (error) {
      console.warn('Cookie consent could not be stored.', error);
    }

    return normalized;
  }

  function applyConsent(preferences, options = {}) {
    const normalized = options.persist === false
      ? normalizePreferences(preferences)
      : persistConsent(preferences);

    window.gtag('consent', 'update', normalized.consent);
    window.dispatchEvent(
      new CustomEvent('mv-cookie-consent-updated', {
        detail: normalized
      })
    );

    return normalized;
  }

  window.gtag('consent', 'default', {
    ...baseConsent,
    wait_for_update: 1500
  });
  window.gtag('set', 'ads_data_redaction', true);
  window.gtag('set', 'url_passthrough', true);

  const storedConsent = readStoredConsent();
  if (storedConsent) {
    window.gtag('consent', 'update', storedConsent.consent);
  }

  window.gtag('js', new Date());
  window.gtag('config', GA_MEASUREMENT_ID, {
    anonymize_ip: true
  });

  window.mvMontConsent = {
    storageKey: STORAGE_KEY,
    applyConsent,
    getStoredConsent: readStoredConsent,
    normalizePreferences
  };

  const gtagScript = document.createElement('script');
  gtagScript.async = true;
  gtagScript.src = `https://www.googletagmanager.com/gtag/js?id=${GA_MEASUREMENT_ID}`;
  document.head.appendChild(gtagScript);

  window.dataLayer.push({
    'gtm.start': Date.now(),
    event: 'gtm.js'
  });

  const gtmScript = document.createElement('script');
  gtmScript.async = true;
  gtmScript.src = `https://www.googletagmanager.com/gtm.js?id=${GTM_ID}`;
  document.head.appendChild(gtmScript);
})();
