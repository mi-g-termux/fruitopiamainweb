/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ─────────────────────────────────────────────────────────────────────────────
 *  Fruitopia — App.tsx  (Root Renderer)
 * ─────────────────────────────────────────────────────────────────────────────
 *
 * All listener management is centralised in AppContext's `_mountListenersForEngine()`.
 * This file manages routing only: install gate, admin panel, order tracker, main site.
 * ─────────────────────────────────────────────────────────────────────────────
 */

import React, { useState, useEffect } from 'react';
import { AppProvider, useApp } from './context/AppContext';
import { ToastProvider, useToast } from './components/Toast';
import { Navbar } from './components/Navbar';
import { Hero } from './components/Hero';
import { FavoritesMenu } from './components/FavoritesMenu';
import { Testimonial } from './components/Testimonial';
import { Newsletter } from './components/Newsletter';
import { Footer } from './components/Footer';
import { CartModal } from './components/CartModal';
import { AdminPanel } from './components/AdminPanel';
import { OrderTrackerPage } from './components/OrderTrackerPage';
import InstallWizard from './components/InstallWizard';
import { firebaseBootPromise, onFirebaseReadyChange } from './firebase';

function AppContent() {
  const [currentPath, setCurrentPath]             = useState(window.location.pathname);
  const [isCartOpen, setIsCartOpen]               = useState(false);
  const [searchQuery, setSearchQuery]             = useState('');
  const [activeCategory, setActiveCategory]       = useState<string | null>(null);
  // ❌ REMOVED: emailBannerDismissed - no longer needed (banner removed)

  // ── INSTALL GATE ──────────────────────────────────────────────────────────
  // The ONLY thing that counts as "installed" is the presence of a valid
  // firebase-config.json file served from the web root or public/ URL. localStorage is NOT
  // trusted — it is per-browser, so an incognito window or a different device
  // would otherwise see the installer while one browser sees the homepage.
  //
  //  - 'checking' : verifying /firebase-config.json
  //  - 'install'  : file missing or invalid → show InstallWizard
  //  - 'ready'    : file present and valid → render the app
  const [installState, setInstallState] = useState<'checking' | 'install' | 'ready'>('checking');

  async function verifyConfigFile(): Promise<boolean> {
    const configUrls = ['/firebase-config.json', '/public/firebase-config.json'];
    for (const url of configUrls) {
      try {
        const res = await fetch(url + '?_v=' + Date.now(), { cache: 'no-store' });
        if (!res.ok) continue;
        const text = await res.text();
        if (text.trimStart().startsWith('<')) continue; // SPA fallback HTML
        const json = JSON.parse(text);
        if (json && typeof json === 'object'
          && typeof json.apiKey === 'string' && json.apiKey.startsWith('AIza')
          && typeof json.projectId === 'string' && json.projectId.length > 0
          && typeof json.authDomain === 'string' && json.authDomain.length > 0) {
          return true;
        }
      } catch {
        // Try the next supported public path.
      }
    }
    return false;
  }

  useEffect(() => {
    let cancelled = false;

    async function checkInstall() {
      // Wait for the Firebase module to finish its own boot attempt so the
      // app can render normally once we flip to 'ready'.
      await firebaseBootPromise;
      if (cancelled) return;

      const fileOk = await verifyConfigFile();
      if (cancelled) return;

      if (!fileOk) {
        // No real config file on the server — installer stays visible.
        setInstallState('install');
        return;
      }

      // File exists. Trust it as the source of truth across all browsers /
      // devices / platforms. Mark ready immediately — no Firestore round-trip
      // and no localStorage caching.
      setInstallState('ready');
    }

    // Expose so InstallWizard can trigger a re-check after the admin uploads
    // the file and clicks "Verify Upload".
    (window as any).__fruitopiaCheckInstall = checkInstall;

    checkInstall();

    const unsub = onFirebaseReadyChange(() => {
      checkInstall();
    });

    return () => {
      cancelled = true;
      unsub();
      delete (window as any).__fruitopiaCheckInstall;
    };
  }, []);


  const {
    siteSettings,
    isAdminLoggedIn,
    isLoading,
    emailVerificationSettings,
    isEmailVerified,
    verifyEmailToken,
    userProfile,
    isUserLoggedIn,
    sendEmailVerification,
  } = useApp();

  const toast = useToast();

  // ── Reset switch: /install?reset=1 wipes browser-side install cache ──
  // Lets the operator force the wizard to reappear after a prior install
  // on the same browser (clears localStorage Firebase + installed flag).
  useEffect(() => {
    if (window.location.pathname === '/install' && new URLSearchParams(window.location.search).get('reset') === '1') {
      try {
        localStorage.removeItem('fruitopia_installed');
        localStorage.removeItem('fruitopia_dynamic_firebase');
        localStorage.removeItem('fruitopia_active_engine');
      } catch {}
      window.history.replaceState({}, '', '/install');
      window.location.reload();
    }
  }, []);

  // ── Path tracking ─────────────────────────────────────────────────────────
  useEffect(() => {
    const handleLocationChange = () => setCurrentPath(window.location.pathname);
    window.addEventListener('popstate', handleLocationChange);
    window.addEventListener('hashchange', handleLocationChange);
    return () => {
      window.removeEventListener('popstate', handleLocationChange);
      window.removeEventListener('hashchange', handleLocationChange);
    };
  }, []);

  // ── Email verification URL param handler ──────────────────────────────────
  // Handles ?verify_token=xxx&verify_email=yyy deep links
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const token  = params.get('verify_token');
    const email  = params.get('verify_email');
    if (token && email) {
      const result = verifyEmailToken(email, token);
      if (result.success) {
        toast.success('✅ Email verified successfully! You can now place orders.');
      } else {
        toast.error(result.message);
      }
      window.history.replaceState({}, '', window.location.pathname);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── Route detection ───────────────────────────────────────────────────────
  const isAdminRoute   = currentPath === '/admin' || window.location.hash === '#admin';
  const isTrackerRoute = currentPath === '/tracker';
  const isInstallRoute = currentPath === '/install';

  // ── INSTALL GATE RENDER ───────────────────────────────────────────────────
  // Block the entire app until Firebase is configured and install_status set.
  // Admin route is always allowed through so an operator can recover.
  // Explicit /install route: show spinner while checking, then wizard always.
  if (installState === 'checking' && !isAdminRoute) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  // Show wizard if: not yet installed, OR operator explicitly navigated to /install
  if ((installState === 'install' || isInstallRoute) && !isAdminRoute) {
    return <InstallWizard />;
  }

  // Admin panel — short-circuit everything else
  if (isAdminRoute) return <AdminPanel />;

  // Loading spinner (only shown when there is no cached siteSettings at all)
  if (isLoading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  // Order Tracker page
  if (isTrackerRoute) {
    if (siteSettings && siteSettings.orderTrackerEnabled === false) {
      window.location.href = '/';
      return null;
    }
    const params    = new URLSearchParams(window.location.search);
    const orderNum  = params.get('order') || '';
    return <OrderTrackerPage initialOrderNumber={orderNum} />;
  }

  // ❌ REMOVED: Email verification banner - OTP verification during signup already handles email verification

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-between selection:bg-[#ff5c35] selection:text-white">

      {/* ❌ REMOVED: Email verification banner (redundant - OTP verification already handles this) */}

      <Navbar
        onCartToggle={() => setIsCartOpen(!isCartOpen)}
        searchQuery={searchQuery}
        setSearchQuery={setSearchQuery}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
      />
      <Hero />
      <FavoritesMenu
        searchQuery={searchQuery}
        activeCategory={activeCategory}
        setActiveCategory={setActiveCategory}
      />
      <Testimonial />
      <Newsletter />
      <Footer />
      <CartModal
        isOpen={isCartOpen}
        onClose={() => setIsCartOpen(false)}
        emailVerified={
          !emailVerificationSettings?.requireVerificationBeforeOrder ||
          isEmailVerified(userProfile?.email || '')
        }
      />
    </div>
  );
}

export default function App() {
  return (
    <ToastProvider>
      <AppProvider>
        <AppContent />
      </AppProvider>
    </ToastProvider>
  );
}
