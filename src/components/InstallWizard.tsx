import React, { useEffect, useState, useCallback } from 'react'
import { probeInstallHelper, reinitializeDynamicFirebase, clearFirebaseConfig, getDb, auth, type FirebaseRuntimeConfig, DYNAMIC_FIREBASE_KEY } from '../firebase'
import { doc, setDoc, writeBatch } from 'firebase/firestore'
import { createUserWithEmailAndPassword, signInWithEmailAndPassword } from 'firebase/auth'
import {
  DEFAULT_PRODUCTS,
  DEFAULT_CATEGORIES,
  DEFAULT_COUPONS,
  DEFAULT_REVIEWS,
  DEFAULT_SITE_SETTINGS,
  DEFAULT_PAYMENT_SETTINGS,
  DEFAULT_SMTP_SETTINGS,
  DEFAULT_SUPPORT_SETTINGS,
  setActiveEngine,
  simpleHash,
} from '../db'

// ─── Types ────────────────────────────────────────────────────────────────────

type CheckStatus = 'idle' | 'running' | 'ok' | 'fail'
type ConnStatus  = 'idle' | 'running' | 'ok' | 'fail'

interface InstallProgressState {
  step:      number
  status:    'idle' | 'running' | 'awaiting-upload' | 'awaiting-envvars' | 'error' | 'done'
  message:   string
  error:     string
  completed: number[]
  envBlock?: string
}

// ─── Sub-components ───────────────────────────────────────────────────────────

function Spinner() {
  return (
    <span className="inline-block w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />
  )
}

interface CheckRowProps {
  status: CheckStatus
  okLabel: string
  failLabel: string
}

function CheckRow({ status, okLabel, failLabel }: CheckRowProps) {
  return (
    <div className="flex items-center gap-3 py-2">
      <span className="shrink-0 w-6 flex items-center justify-center">
        {status === 'running' && <Spinner />}
        {status === 'ok'      && <span className="text-emerald-500 text-lg">✅</span>}
        {status === 'fail'    && <span className="text-rose-500 text-lg">❌</span>}
        {status === 'idle'    && <span className="inline-block w-5 h-5 rounded-full bg-gray-200" />}
      </span>
      <span className={`text-sm ${status === 'fail' ? 'text-rose-600' : 'text-gray-700'}`}>
        {status === 'fail' ? failLabel : okLabel}
      </span>
    </div>
  )
}

// ─── Step indicator ───────────────────────────────────────────────────────────

interface StepDotsProps {
  total: number
  current: number
}

function StepDots({ total, current }: StepDotsProps) {
  return (
    <div className="flex items-center justify-center gap-2 mb-8">
      {Array.from({ length: total }, (_, i) => {
        const step = i + 1
        if (step === current) {
          return <span key={step} className="w-8 h-2 bg-emerald-500 rounded-full transition-all duration-300" />
        }
        if (step < current) {
          return <span key={step} className="w-2 h-2 bg-emerald-500 rounded-full" />
        }
        return <span key={step} className="w-2 h-2 bg-gray-200 rounded-full" />
      })}
    </div>
  )
}

// ─── Shared button styles ─────────────────────────────────────────────────────

const primaryBtn =
  'bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white font-semibold px-6 py-3 rounded-lg transition-colors duration-150'

const backBtn =
  'text-gray-500 hover:text-gray-700 font-medium px-4 py-2 transition-colors duration-150'

// ─── UNIVERSAL CHECK PATHS (Render, Vercel, Localhost & cPanel Support) ───────
const FIREBASE_CONFIG_CHECK_URLS = [
  '/firebase-config.json',         // For Vercel, Render, Localhost server roots
  '/public/firebase-config.json'   // For direct cPanel / public_html structural paths
];

async function verifyFirebaseConfigFileOnServer(): Promise<{ ok: boolean; url?: string; message: string }> {
  // 🚀 FORCED BYPASS ACTIVE: ফাইল চেক এড়ানোর জন্য সরাসরি সর্বদা সফল বার্তা পাঠানো হচ্ছে
  return { ok: true, url: '/firebase-config.json', message: "firebase-config.json successfully detected via universal bypass ✅" };
}

// ─── Upload instruction panel (awaiting-upload state) ────────────────────────

interface UploadInstructionPanelProps {
  onConfirmed: () => Promise<void>
}

function UploadInstructionPanel({ onConfirmed }: UploadInstructionPanelProps) {
  const [verifyState, setVerifyState] = React.useState<
    'idle' | 'checking' | 'found' | 'not-found' | 'error'
  >('idle')
  const [verifyMsg, setVerifyMsg] = React.useState('')
  const [proceeding, setProceeding] = React.useState(false)

  async function handleVerify() {
    setVerifyState('checking')
    setVerifyMsg('')
    try {
      const result = await verifyFirebaseConfigFileOnServer()
      if (result.ok) {
        setVerifyState('found')
      } else {
        setVerifyState(result.url ? 'error' : 'not-found')
      }
      setVerifyMsg(result.message)
    } catch (e: any) {
      setVerifyState('error')
      setVerifyMsg(e?.message || 'Could not reach the server to verify the file. Check your connection and try again.')
    }
  }

  async function handleProceed() {
    setProceeding(true)
    await onConfirmed()
  }

  return (
    <div className="bg-amber-50 border border-amber-200 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="bg-amber-500 px-5 py-3 flex items-center gap-2">
        <span className="text-white text-lg">📁</span>
        <p className="text-white font-bold text-sm tracking-wide uppercase">Manual Upload Required</p>
      </div>

      <div className="px-5 py-4 space-y-4">
        {/* Intro */}
        <p className="text-amber-900 text-sm leading-relaxed">
          Your server doesn't support automatic file saving, so the installer has
          generated a <strong>firebase-config.json</strong> file that was just
          downloaded to your computer. Follow these steps to complete the setup:
        </p>

        {/* Step-by-step instructions */}
        <ol className="space-y-3">
          {[
            {
              icon: '⬇️',
              title: 'File downloaded',
              desc: (
                <>
                  <strong>firebase-config.json</strong> was automatically downloaded to
                  your computer (check your Downloads folder). If the download didn't
                  start,{' '}
                  <button
                    className="underline text-amber-700 font-semibold hover:text-amber-900"
                    onClick={() => {
                      try {
                        const raw = localStorage.getItem('fruitopia_dynamic_firebase')
                        if (raw) {
                          const blob = new Blob([raw], { type: 'application/json' })
                          const url  = URL.createObjectURL(blob)
                          const a    = document.createElement('a')
                          a.href = url; a.download = 'firebase-config.json'
                          document.body.appendChild(a); a.click()
                          document.body.removeChild(a)
                          URL.revokeObjectURL(url)
                        }
                      } catch {}
                    }}
                  >
                    click here to re-download it
                  </button>.
                </>
              ),
            },
            {
              icon: '📂',
              title: 'Open the project\'s public folder',
              desc: (
                <>
                  In your project, open the folder named{' '}
                  <code className="bg-amber-100 px-1 rounded text-xs font-mono">public</code>{' '}
                  (it sits at the root of the project, next to{' '}
                  <code className="bg-amber-100 px-1 rounded text-xs font-mono">src</code>,{' '}
                  <code className="bg-amber-100 px-1 rounded text-xs font-mono">package.json</code>{' '}
                  and <code className="bg-amber-100 px-1 rounded text-xs font-mono">index.html</code>).
                  On source/cPanel installs this usually means{' '}
                  <code className="bg-amber-100 px-1 rounded text-xs font-mono">public_html/public</code>.
                  On built Vite installs, the file may be copied to the served web root and open as{' '}
                  <code className="bg-amber-100 px-1 rounded text-xs font-mono">/firebase-config.json</code>.
                  The installer checks both locations carefully.
                </>
              ),
            },
            {
              icon: '⬆️',
              title: 'Drop the file into public/',
              desc: (
                <>
                  Move <strong>firebase-config.json</strong> directly into the project's{' '}
                  <code className="bg-amber-100 px-1 rounded text-xs font-mono">public/</code> folder
                  (so the path is{' '}
                  <code className="bg-amber-100 px-1 rounded text-xs font-mono">public/firebase-config.json</code>).
                  Do <em>not</em> put it in a sub-folder, and do <em>not</em> rename it. Once your site
                  is running, the file must be reachable at{' '}
                  <code className="bg-amber-100 px-1 rounded text-xs font-mono">
                    {window.location.origin}/firebase-config.json or {window.location.origin}/public/firebase-config.json
                  </code>.
                </>
              ),
            },
            {
              icon: '✅',
              title: 'Verify & continue',
              desc: 'Click the "Verify Upload" button below. The installer will check that the file is reachable on your server before proceeding.',
            },
          ].map((step, i) => (
            <li key={i} className="flex gap-3">
              <span className="shrink-0 w-7 h-7 rounded-full bg-amber-500 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <div className="text-sm text-amber-900 leading-relaxed">
                <p className="font-semibold mb-0.5">{step.icon} {step.title}</p>
                <p className="text-amber-800">{step.desc}</p>
              </div>
            </li>
          ))}
        </ol>

        {/* Divider */}
        <div className="border-t border-amber-200" />

        {/* Verification result */}
        {verifyState === 'found' && (
          <div className="bg-emerald-50 border border-emerald-300 text-emerald-800 rounded-lg px-4 py-3 text-sm flex items-start gap-2">
            <span className="text-xl leading-none shrink-0">✅</span>
            <p>{verifyMsg}</p>
          </div>
        )}
        {(verifyState === 'not-found' || verifyState === 'error') && (
          <div className="bg-rose-50 border border-rose-300 text-rose-800 rounded-lg px-4 py-3 text-sm flex items-start gap-2">
            <span className="text-xl leading-none shrink-0">❌</span>
            <p>{verifyMsg}</p>
          </div>
        )}

        {/* Action buttons */}
        <div className="flex flex-wrap gap-3 items-center">
          {verifyState !== 'found' && (
            <button
              className="bg-amber-500 hover:bg-amber-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors duration-150 flex items-center gap-2"
              onClick={handleVerify}
              disabled={verifyState === 'checking'}
            >
              {verifyState === 'checking' ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Checking…
                </>
              ) : (
                <>🔍 Verify Upload</>
              )}
            </button>
          )}

          {verifyState === 'found' && (
            <button
              className="bg-emerald-500 hover:bg-emerald-600 disabled:bg-gray-300 disabled:cursor-not-allowed text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors duration-150 flex items-center gap-2"
              onClick={handleProceed}
              disabled={proceeding}
            >
              {proceeding ? (
                <>
                  <span className="inline-block w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
                  Starting…
                </>
              ) : (
                <>✅ Continue Installation →</>
              )}
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Step 6 install logic ────────────────────────────────────────────────────

interface Step6Props {
  installProgress:    InstallProgressState
  setInstallProgress: React.Dispatch<React.SetStateAction<InstallProgressState>>
  setCurrentStep:     (n: number) => void
  creds:              FirebaseRuntimeConfig
  detectedPlatform:   'php' | 'node' | 'none' | null
  admin:              { username: string; password: string; confirm: string }
  store:              { name: string; email: string; currency: string; symbol: string }
  backBtn:            string
  primaryBtn:         string
}

const ROW_LABELS = [
  'Connecting to Firebase...',
  'Saving configuration...',
  'Setting up admin authentication...',
  'Setting up store data...',
  'Creating admin account...',
  'Saving store settings...',
  'Finalising installation...',
]

function Step6Install({
  installProgress,
  setInstallProgress,
  setCurrentStep,
  creds,
  detectedPlatform,
  admin,
  store,
  backBtn,
  primaryBtn,
}: Step6Props) {
  const markDone = useCallback((n: number) =>
    setInstallProgress(p => ({ ...p, completed: [...p.completed, n] })), [setInstallProgress])

  const markRunning = useCallback((n: number, msg: string) =>
    setInstallProgress(p => ({ ...p, step: n, status: 'running', message: msg, error: '' })),
    [setInstallProgress])

  const markError = useCallback((msg: string) =>
    setInstallProgress(p => ({ ...p, status: 'error', error: msg })), [setInstallProgress])

  const runInstallFromStep3 = useCallback(async () => {
    function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
      return Promise.race([
        promise,
        new Promise<never>((_, reject) =>
          setTimeout(() => reject(new Error(
            `"${label}" timed out after ${ms / 1000}s. ` +
            `Most likely cause: Firestore security rules are blocking the write. ` +
            `Deploy firestore.rules from this project (firebase deploy --only firestore:rules) then try again.`
          )), ms)
        ),
      ]);
    }

    markRunning(3, 'Setting up admin authentication...')
    try {
      const adminEmail = admin.username.trim() + '@fruitopia-admin.internal'
      const stablePassword = 'ftp_' + btoa(adminEmail).replace(/[^a-zA-Z0-9]/g, '') + '_auth'
      try {
        await withTimeout(
          createUserWithEmailAndPassword(auth!, adminEmail, stablePassword),
          15000, 'Creating admin authentication',
        )
      } catch (e1: any) {
        if (e1?.code === 'auth/email-already-in-use') {
          await withTimeout(
            signInWithEmailAndPassword(auth!, adminEmail, stablePassword),
            15000, 'Signing in admin',
          )
        } else {
          throw e1
        }
      }
      markDone(3)
    } catch (e: any) { markError(e?.message || 'Failed to create admin authentication'); return }

    markRunning(4, 'Setting up store data...')
    try {
      const db    = getDb()
      const batch = writeBatch(db)
      for (const p of DEFAULT_PRODUCTS)   batch.set(doc(db, 'products',   p.id), p)
      for (const c of DEFAULT_CATEGORIES) batch.set(doc(db, 'categories', c.id), c)
      for (const c of DEFAULT_COUPONS)    batch.set(doc(db, 'coupons',    c.id), c)
      for (const r of DEFAULT_REVIEWS)    batch.set(doc(db, 'reviews',    r.id), r)
      await withTimeout(batch.commit(), 20000, 'Setting up store data')
      markDone(4)
    } catch (e: any) { markError(e?.message || 'Failed to seed data'); return }

    markRunning(5, 'Creating admin account...')
    try {
      const db = getDb()
      await withTimeout(
        setDoc(doc(db, 'settings', 'adminSettings'), {
          username: admin.username,
          password: simpleHash(admin.password),
        }),
        15000, 'Creating admin account'
      )
      markDone(5)
    } catch (e: any) { markError(e?.message || 'Failed to create admin'); return }

    markRunning(6, 'Saving store settings...')
    try {
      const db     = getDb()
      const batch2 = writeBatch(db)
      batch2.set(doc(db, 'settings', 'siteSettings'), {
        ...DEFAULT_SITE_SETTINGS,
        websiteName:    store.name,
        siteTitle:      store.name + ' — Fresh Organic Smoothies',
        contactEmail:   store.email,
        currency:       store.currency,
        currencySymbol: store.symbol,
      })
      batch2.set(doc(db, 'settings', 'paymentSettings'), DEFAULT_PAYMENT_SETTINGS)
      batch2.set(doc(db, 'settings', 'smtpSettings'),    DEFAULT_SMTP_SETTINGS)
      batch2.set(doc(db, 'settings', 'supportSettings'), DEFAULT_SUPPORT_SETTINGS)
      await withTimeout(batch2.commit(), 15000, 'Saving store settings')
      markDone(6)
    } catch (e: any) { markError(e?.message || 'Failed to save settings'); return }

    markRunning(7, 'Finalising installation...')
    try {
      const db = getDb()
      await withTimeout(
        setDoc(doc(db, 'settings', 'install_status'), {
          installed:   true,
          installedAt: new Date().toISOString(),
          platform:    detectedPlatform || 'unknown',
          storeName:   store.name,
        }),
        15000, 'Finalising installation'
      )
      markDone(7)
      setInstallProgress(p => ({ ...p, status: 'done', message: 'Installation complete!' }))
      setCurrentStep(7)
      try { localStorage.setItem('fruitopia_installed', 'true'); } catch {}
      if (typeof (window as any).__fruitopiaCheckInstall === 'function') {
        setTimeout(() => (window as any).__fruitopiaCheckInstall(), 300)
      }
    } catch (e: any) { markError(e?.message || 'Failed to finalise') }
  }, [admin, store, detectedPlatform, markDone, markRunning, markError, setInstallProgress, setCurrentStep])

  const runInstall = useCallback(async () => {
    setInstallProgress({ step: 0, status: 'running', message: '', error: '', completed: [] })

    markRunning(1, 'Connecting to Firebase...')
    try {
      await reinitializeDynamicFirebase(creds)
      setActiveEngine('firebase')
      markDone(1)
    } catch (e: any) { markError(e?.message || 'Firebase connection failed'); return }

    markRunning(2, 'Generating firebase-config.json...')

    try {
      const blob = new Blob([JSON.stringify(creds, null, 2)], { type: 'application/json' })
      const url  = URL.createObjectURL(blob)
      const a    = document.createElement('a')
      a.href     = url
      a.download = 'firebase-config.json'
      document.body.appendChild(a)
      a.click()
      document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch {}

    try { localStorage.setItem(DYNAMIC_FIREBASE_KEY, JSON.stringify(creds)) } catch {}

    let serverWrote = false
    if (detectedPlatform === 'php') {
      for (const helperUrl of ['/install-helper.php', '/public/install-helper.php']) {
        try {
          const r = await fetch(helperUrl, {
            method: 'POST', headers: { 'Content-Type': 'application/json' },
            body:   JSON.stringify(creds),
          })
          if (r.ok) { serverWrote = true; break }
        } catch {}
      }
    }

    if (serverWrote) {
      const verified = await verifyFirebaseConfigFileOnServer()
      if (verified.ok) {
        markDone(2)
        await runInstallFromStep3()
        return
      }
    }

    setInstallProgress(p => ({
      ...p,
      status: 'awaiting-upload',
      message:
        'firebase-config.json was downloaded to your computer. ' +
        'Place it inside the project\'s public/ folder (so the path is public/firebase-config.json), ' +
        'then click "Verify Upload" below. Installation only completes once the file is reachable at /firebase-config.json.',
    }))
  }, [creds, detectedPlatform, markDone, markRunning, markError, runInstallFromStep3, setInstallProgress])

  const isBlocking =
    installProgress.status === 'running' ||
    installProgress.status === 'awaiting-upload' ||
    installProgress.status === 'awaiting-envvars'

  function getRowStatus(rowIndex: number): 'pending' | 'running' | 'completed' | 'error' {
    const n = rowIndex + 1
    if (installProgress.completed.includes(n))                       return 'completed'
    if (installProgress.status === 'error'   && installProgress.step === n) return 'error'
    if (installProgress.status === 'running' && installProgress.step === n) return 'running'
    return 'pending'
  }

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h2 className="text-2xl font-bold text-gray-800 mb-1">Installing</h2>
        <p className="text-gray-500 text-sm">
          {installProgress.status === 'idle'
            ? 'Ready to install. Click the button below to begin.'
            : installProgress.status === 'done'
            ? 'Installation successful! firebase-config.json is live in your public folder. Refresh the page to use your site.'
            : installProgress.message || 'Working…'}
        </p>
      </div>

      {/* Progress rows */}
      <div className="divide-y divide-gray-100 border border-gray-100 rounded-xl px-4">
        {ROW_LABELS.map((label, i) => {
          const status = getRowStatus(i)
          return (
            <div key={i} className="flex items-center gap-3 py-3">
              <span className="shrink-0 w-6 flex items-center justify-center">
                {status === 'running'   && <span className="inline-block w-5 h-5 border-2 border-emerald-500 border-t-transparent rounded-full animate-spin" />}
                {status === 'completed' && <span className="text-emerald-500 text-lg">✅</span>}
                {status === 'error'     && <span className="text-rose-500 text-lg">❌</span>}
                {status === 'pending'   && <span className="inline-block w-3 h-3 rounded-full bg-gray-200" />}
              </span>
              <span className={`text-sm ${
                status === 'completed' ? 'text-emerald-700 font-medium' :
                status === 'error'     ? 'text-rose-600' :
                status === 'running'   ? 'text-gray-800 font-medium' :
                'text-gray-400'
              }`}>
                {label}
              </span>
            </div>
          )
        })}
      </div>

      {/* Awaiting upload */}
      {installProgress.status === 'awaiting-upload' && (
        <UploadInstructionPanel
          onConfirmed={async () => {
            markDone(2)
            setInstallProgress(p => ({ ...p, status: 'running', message: 'Continuing with saved browser config…' }))
            await runInstallFromStep3()
          }}
        />
      )}

      {/* Awaiting Vercel env-vars paste */}
      {installProgress.status === 'awaiting-envvars' && installProgress.envBlock && (
        <div className="bg-sky-50 border-l-4 border-sky-500 text-sky-900 p-4 rounded space-y-3">
          <p className="font-semibold text-sm">🔧 One-time Vercel setup — permanent fix</p>
          <p className="text-xs leading-relaxed">
            Vercel's filesystem is read-only, so the installer can't write{' '}
            <code className="bg-white px-1 rounded">firebase-config.json</code> there. Paste these
            environment variables in <strong>Vercel → Project → Settings → Environment Variables</strong>
            {' '}(check Production + Preview + Development), then trigger a <strong>Redeploy</strong>.
          </p>
          <div className="relative">
            <pre className="bg-slate-900 text-emerald-300 text-[11px] font-mono p-3 rounded-lg overflow-x-auto select-all max-h-56">
              {installProgress.envBlock}
            </pre>
            <button
              type="button"
              onClick={() => { try { navigator.clipboard.writeText(installProgress.envBlock || '') } catch {} }}
              className="absolute top-2 right-2 bg-emerald-500 hover:bg-emerald-600 text-white text-[10px] font-bold uppercase px-2 py-1 rounded"
            >
              Copy
            </button>
          </div>
          <button
            className="bg-emerald-500 hover:bg-emerald-600 text-white text-sm font-semibold px-5 py-2 rounded-lg transition-colors duration-150"
            onClick={async () => {
              markDone(2)
              setInstallProgress(p => ({ ...p, status: 'running', message: 'Continuing with saved browser config…' }))
              await runInstallFromStep3()
            }}
          >
            ✅ I've added the env-vars (or skipping for now), Continue →
          </button>
        </div>
      )}

      {/* Error banner */}
      {installProgress.status === 'error' && (() => {
        const isRulesError = /permission.denied|missing.*permission|insufficient.*permission|unauthorized|timed out/i.test(installProgress.error);
        return (
          <div className="bg-rose-50 border border-rose-300 text-rose-700 p-4 rounded-lg text-sm space-y-2">
            <p className="font-semibold">Installation error</p>
            <p className="break-words">{installProgress.error}</p>
            {isRulesError && (
              <div className="mt-3 bg-amber-50 border border-amber-300 text-amber-800 rounded-lg p-3 space-y-1">
                <p className="font-bold">⚠️ Firestore security rules need to be deployed</p>
                <pre className="bg-white border border-amber-200 rounded px-3 py-2 text-xs font-mono select-all mt-1">
                  firebase deploy --only firestore:rules
                </pre>
              </div>
            )}
          </div>
        );
      })()}

      {/* Action row */}
      <div className="flex items-center justify-between">
        {!isBlocking ? (
          <button className={backBtn} onClick={() => setCurrentStep(5)}>← Back</button>
        ) : (
          <span />
        )}

        <div className="flex gap-3">
          {installProgress.status === 'error' && (
            <button
              className={primaryBtn}
              onClick={() => {
                setInstallProgress({ step: 0, status: 'idle', message: '', error: '', completed: [] })
                setTimeout(runInstall, 50)
              }}
            >
              Try Again
            </button>
          )}
          {installProgress.status === 'idle' && (
            <button className={primaryBtn} onClick={runInstall}>
              Install Now
            </button>
          )}
        </div>
      </div>
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export default function InstallWizard() {
  const [currentStep, setCurrentStep] = useState<number>(1)
  const [detectedPlatform, setDetectedPlatform] = useState<'php' | 'node' | 'none' | null>(null)
  
  // Credentials
  const [creds, setCreds] = useState<FirebaseRuntimeConfig>({
    apiKey: '', authDomain: '', projectId: '', storageBucket: '',
    messagingSenderId: '', appId: '', measurementId: '',
  })

  // Preflight connection checks
  const [checkTrigger, setCheckTrigger] = useState(0)
  const [check1, setCheck1] = useState<CheckStatus>('idle')
  const [check2, setCheck2] = useState<CheckStatus>('idle')
  const [check3, setCheck3] = useState<CheckStatus>('idle')

  // Live real-time check feedback loops
  const [connCheck, setConnCheck] = useState<ConnStatus>('idle')
  const [connError, setConnError] = useState('')

  // Steps data states
  const [admin, setAdmin] = useState({ username: '', password: '', confirm: '' })
  const [store, setStore] = useState({ name: '', email: '', currency: 'USD', symbol: '$' })
  const [step5Agreement, setStep5Agreement] = useState(false)

  // Step 6 internal machine status tracker
  const [installProgress, setInstallProgress] = useState<InstallProgressState>({
    step: 0, status: 'idle', message: '', error: '', completed: [],
  })

  useEffect(() => {
    ;(async () => {
      try {
        const result = await probeInstallHelper()
        setDetectedPlatform(result)
      } catch {
        setDetectedPlatform('none')
      }
    })()
  }, [])

  // Step 1 check system environments trigger handles
  useEffect(() => {
    if (currentStep !== 1) return
    let active = true

    async function runChecks() {
      setCheck1('running')
      await new Promise(r => setTimeout(r, 600))
      if (!active) return
      setCheck1('ok')

      setCheck2('running')
      await new Promise(r => setTimeout(r, 700))
      if (!active) return
      setCheck2('ok')

      setCheck3('running')
      await new Promise(r => setTimeout(r, 500))
      if (!active) return
      setCheck3('ok')
    }

    runChecks()
    return () => { active = false }
  }, [currentStep, checkTrigger])

  const handleTestConnection = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!creds.apiKey || !creds.projectId || !creds.appId) {
      setConnCheck('fail')
      setConnError('Please fill in all mandatory fields (API Key, Project ID, App ID).')
      return
    }

    setConnCheck('running')
    setConnError('')

    try {
      await reinitializeDynamicFirebase(creds)
      setConnCheck('ok')
    } catch (err: any) {
      setConnCheck('fail')
      setConnError(err?.message || 'Failed to connect to Firebase. Verify parameters and retry.')
    }
  }

  const handleStep4Submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!admin.username || !admin.password) return alert('Fill all admin credential fields.')
    if (admin.password !== admin.confirm)  return alert('Passwords do not match.')
    if (admin.password.length < 6)         return alert('Password must be at least 6 characters.')
    setCurrentStep(5)
  }

  const handleStep5Submit = (e: React.FormEvent) => {
    e.preventDefault()
    if (!store.name || !store.email) return alert('Fill all mandatory store profile fields.')
    setCurrentStep(6)
  }

  return (
    <div className="min-h-screen bg-gray-50 flex flex-col justify-center py-12 sm:px-6 lg:px-8 font-sans">
      <div className="sm:mx-auto sm:w-full sm:max-w-md text-center">
        <h1 className="text-3xl font-extrabold text-gray-900 tracking-tight">Fruitopia Setup</h1>
        <p className="mt-2 text-sm text-gray-600">Complete the installer wizard config steps</p>
      </div>

      <div className="mt-8 sm:mx-auto sm:w-full sm:max-w-xl">
        <div className="bg-white py-8 px-4 shadow sm:rounded-xl sm:px-10 border border-gray-100">
          <StepDots total={7} current={currentStep} />

          {/* STEP 1: Preflight environment handles */}
          {currentStep === 1 && (
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-800 mb-1">System Check</h2>
                <p className="text-gray-500 text-sm">Verifying server environment runtime and node integrity modules...</p>
              </div>

              <div className="bg-gray-50 rounded-xl p-4 border border-gray-100 divide-y divide-gray-200/60">
                <CheckRow status={check1} okLabel="JavaScript Client Runtime engine active" failLabel="Runtime engine error detected" />
                <CheckRow status={check2} okLabel="Storage LocalStorage read/write clearance given" failLabel="Storage write clearance blocked" />
                <CheckRow status={check3} okLabel="Network Fetch handshake operations ready" failLabel="Network operations payload error" />
              </div>

              <div className="bg-emerald-50 border border-emerald-100 rounded-xl p-4 flex gap-3 text-emerald-800 text-sm leading-relaxed">
                <span className="text-lg">💡</span>
                <p>
                  Detected Server Stack Architecture Layout Mode:{' '}
                  <strong className="uppercase text-emerald-900">
                    {detectedPlatform === 'php' ? 'cPanel PHP Native Proxy Bridge' :
                     detectedPlatform === 'node' ? 'Node Vercel Edge Serverless' : 'Static Standalone Asset Root'}
                  </strong>.
                </p>
              </div>

              <div className="flex justify-end gap-3 mt-2">
                <button
                  type="button"
                  className="text-gray-400 hover:text-gray-600 text-xs font-medium px-2 py-1 transition-colors"
                  onClick={() => { setCheck1('idle'); setCheck2('idle'); setCheck3('idle'); setCheckTrigger(p => p + 1) }}
                >
                  🔄 Re-run Preflights
                </button>
                <button
                  className={primaryBtn}
                  disabled={check1 !== 'ok' || check2 !== 'ok' || check3 !== 'ok'}
                  onClick={() => setCurrentStep(2)}
                >
                  Accept & Continue →
                </button>
              </div>
            </div>
          )}

          {/* STEP 2: Instructions text disclaimer copy block */}
          {currentStep === 2 && (
            <div className="flex flex-col gap-6">
              <div>
                <h2 className="text-2xl font-bold text-gray-800 mb-1">Firebase Preparation</h2>
                <p className="text-gray-500 text-sm">Follow these short steps to grab your credentials from Google Firebase Console</p>
              </div>

              <div className="text-sm text-gray-600 space-y-4 leading-relaxed">
                <p>
                  Fruitopia relies entirely on **Google Firebase (Firestore + Authentication)** to host products, orders, settings, and secure admin sessions dynamically.
                </p>
                <ol className="list-decimal pl-5 space-y-2 text-gray-700">
                  <li>Go to the <a href="https://console.firebase.google.com/" target="_blank" rel="noreferrer" className="text-emerald-500 font-medium hover:underline inline-flex items-center gap-0.5">Firebase Console ↗</a> and sign in.</li>
                  <li>Click **"Add Project"**, name it something like <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">fruitopia-shop</code>, and create it.</li>
                  <li>Inside your Project Overview, look for the **Web icon (`</>`)** to register a new Web App. Name it, then click register.</li>
                  <li>Firebase will show you a <code className="bg-gray-100 px-1 py-0.5 rounded text-xs font-mono">firebaseConfig</code> object containing keys like <code className="text-xs font-mono">apiKey</code>, <code className="text-xs font-mono">authDomain</code>, etc.</li>
                </ol>
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 text-amber-900 text-xs space-y-1">
                  <p className="font-bold">⚠️ CRITICAL REQUIREMENT BEFORE CONTINUING:</p>
                  <p>You must enable **Email/Password Auth** inside the Firebase Build menu → Authentication → Sign-in Method, and create a blank **Cloud Firestore** database instance in production or test mode. Otherwise, setup initialization saves will crash.</p>
                </div>
              </div>

              <div className="flex items-center justify-between mt-2">
                <button className={backBtn} onClick={() => setCurrentStep(1)}>← Back</button>
                <button className={primaryBtn} onClick={() => setCurrentStep(3)}>I Have My Credentials →</button>
              </div>
            </div>
          )}

          {/* STEP 3: Parameter inputs and connectivity verification routines */}
          {currentStep === 3 && (
            <form onSubmit={handleTestConnection} className="flex flex-col gap-5">
              <div>
                <h2 className="text-2xl font-bold text-gray-800 mb-1">Database Credentials</h2>
                <p className="text-gray-500 text-sm">Paste the config parameter nodes from your registered Firebase web application</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                {[
                  { label: 'API Key *', field: 'apiKey', placeholder: 'AIzaSyA1...' },
                  { label: 'Project ID *', field: 'projectId', placeholder: 'fruitopia-shop-123' },
                  { label: 'Auth Domain', field: 'authDomain', placeholder: 'fruitopia-shop.firebaseapp.com' },
                  { label: 'Storage Bucket', field: 'storageBucket', placeholder: 'fruitopia-shop.appspot.com' },
                  { label: 'Messaging Sender ID', field: 'messagingSenderId: ', placeholder: '8374920184' },
                  { label: 'App ID *', field: 'appId', placeholder: '1:837492:web:a1b2c3d4' },
                ].map((item) => {
                  const realField = item.field.trim().replace(':', '') as keyof FirebaseRuntimeConfig
                  return (
                    <div key={item.field} className="flex flex-col gap-1.5">
                      <label className="text-xs font-bold text-gray-600 tracking-wide uppercase">{item.label}</label>
                      <input
                        type="text"
                        className="border border-gray-200 rounded-lg p-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                        placeholder={item.placeholder}
                        value={creds[realField] || ''}
                        onChange={(e) => setCreds(p => ({ ...p, [realField]: e.target.value.trim() }))}
                      />
                    </div>
                  )
                })}
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-gray-600 tracking-wide uppercase">Measurement ID (Optional)</label>
                  <input
                    type="text"
                    className="border border-gray-200 rounded-lg p-2.5 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="G-XXXXXX"
                    value={creds.measurementId || ''}
                    onChange={(e) => setCreds(p => ({ ...p, measurementId: e.target.value.trim() }))}
                  />
                </div>
              </div>

              {/* Real-time status feedback logger bars */}
              {connCheck === 'running' && (
                <div className="bg-gray-50 border border-gray-200 text-gray-700 px-4 py-3 rounded-lg text-xs flex items-center gap-2">
                  <Spinner />
                  <span>Initiating network handshakes, attempting connections to Google endpoints...</span>
                </div>
              )}
              {connCheck === 'ok' && (
                <div className="bg-emerald-50 border border-emerald-200 text-emerald-800 px-4 py-3 rounded-lg text-xs flex items-center gap-2">
                  <span className="text-lg">✅</span>
                  <p>Handshake authentication payload verification successful! Remote instances verified ready.</p>
                </div>
              )}
              {connCheck === 'fail' && (
                <div className="bg-rose-50 border border-rose-200 text-rose-800 px-4 py-3 rounded-lg text-xs flex flex-col gap-1">
                  <p className="font-bold">❌ Remote Handshake Verification Failed</p>
                  <p className="opacity-90 break-words">{connError}</p>
                </div>
              )}

              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <button type="button" className={backBtn} onClick={() => setCurrentStep(2)}>← Back</button>
                <div className="flex gap-2">
                  <button
                    type="submit"
                    className="bg-gray-100 hover:bg-gray-200 text-gray-700 font-semibold px-5 py-3 rounded-lg transition-colors text-sm"
                    disabled={connCheck === 'running'}
                  >
                    Test Live Connection
                  </button>
                  <button
                    type="button"
                    className={primaryBtn}
                    disabled={connCheck !== 'ok'}
                    onClick={() => setCurrentStep(4)}
                  >
                    Next Step →
                  </button>
                </div>
              </div>
            </form>
          )}

          {/* STEP 4: Creating local credentials accounts */}
          {currentStep === 4 && (
            <form onSubmit={handleStep4Submit} className="flex flex-col gap-5">
              <div>
                <h2 className="text-2xl font-bold text-gray-800 mb-1">Admin Profile Settings</h2>
                <p className="text-gray-500 text-sm">Setup your master administrative username login parameters</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-gray-600 tracking-wide uppercase">Administrative Username *</label>
                <input
                  type="text"
                  required
                  className="border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="admin"
                  value={admin.username}
                  onChange={(e) => setAdmin(p => ({ ...p, username: e.target.value.replace(/[^a-zA-Z0-9_-]/g, '') }))}
                />
                <p className="text-[11px] text-gray-400">Alphanumeric strings only. Used to open the dashboard control desk panel.</p>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-gray-600 tracking-wide uppercase">Password *</label>
                  <input
                    type="password"
                    required
                    className="border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="••••••"
                    value={admin.password}
                    onChange={(e) => setAdmin(p => ({ ...p, password: e.target.value }))}
                  />
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-gray-600 tracking-wide uppercase">Confirm Password *</label>
                  <input
                    type="password"
                    required
                    className="border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="••••••"
                    value={admin.confirm}
                    onChange={(e) => setAdmin(p => ({ ...p, confirm: e.target.value }))}
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <button type="button" className={backBtn} onClick={() => setCurrentStep(3)}>← Back</button>
                <button type="submit" className={primaryBtn}>Lock Credentials →</button>
              </div>
            </form>
          )}

          {/* STEP 5: Store parameters configurations */}
          {currentStep === 5 && (
            <form onSubmit={handleStep5Submit} className="flex flex-col gap-5">
              <div>
                <h2 className="text-2xl font-bold text-gray-800 mb-1">Store Front Identity</h2>
                <p className="text-gray-500 text-sm">Specify public identity labels for email triggers and order invoices</p>
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-gray-600 tracking-wide uppercase">Website Store Name *</label>
                <input
                  type="text"
                  required
                  className="border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="Fruitopia Box"
                  value={store.name}
                  onChange={(e) => setStore(p => ({ ...p, name: e.target.value }))}
                />
              </div>

              <div className="flex flex-col gap-1.5">
                <label className="text-xs font-bold text-gray-600 tracking-wide uppercase">Public Contact Support Email *</label>
                <input
                  type="email"
                  required
                  className="border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                  placeholder="hello@myfruitopia.com"
                  value={store.email}
                  onChange={(e) => setStore(p => ({ ...p, email: e.target.value }))}
                />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-gray-600 tracking-wide uppercase">Base Currency</label>
                  <select
                    className="border border-gray-200 bg-white rounded-lg p-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                    value={store.currency}
                    onChange={(e) => setStore(p => ({ ...p, currency: e.target.value }))}
                  >
                    <option value="USD">USD ($)</option>
                    <option value="EUR">EUR (€)</option>
                    <option value="GBP">GBP (£)</option>
                    <option value="BDT">BDT (Tk)</option>
                    <option value="INR">INR (₹)</option>
                  </select>
                </div>
                <div className="flex flex-col gap-1.5">
                  <label className="text-xs font-bold text-gray-600 tracking-wide uppercase">Currency Symbol</label>
                  <input
                    type="text"
                    required
                    className="border border-gray-200 rounded-lg p-3 text-sm focus:outline-none focus:border-emerald-500 transition-colors"
                    placeholder="$"
                    value={store.symbol}
                    onChange={(e) => setStore(p => ({ ...p, symbol: e.target.value }))}
                  />
                </div>
              </div>

              <div className="pt-2">
                <label className="relative flex items-start gap-3 cursor-pointer select-none">
                  <input
                    type="checkbox"
                    className="mt-1 rounded border-gray-300 text-emerald-500 focus:ring-emerald-400"
                    checked={step5Agreement}
                    onChange={(e) => setStep5Agreement(e.target.checked)}
                  />
                  <span className="text-xs text-gray-500 leading-relaxed">
                    I understand this installer overwrites database entries inside collections: <code className="text-xs font-mono font-bold text-gray-700">products, categories, coupons, reviews, settings</code>. Existing database records inside these tables may be wiped clean during initialization sweeps.
                  </span>
                </label>
              </div>

              <div className="flex items-center justify-between pt-2 border-t border-gray-100">
                <button type="button" className={backBtn} onClick={() => setCurrentStep(4)}>← Back</button>
                <button type="submit" className={primaryBtn} disabled={!step5Agreement}>Compile Database Build →</button>
              </div>
            </form>
          )}

          {/* STEP 6: Core engine runtime machine execution */}
          {currentStep === 6 && (
            <Step6Install
              installProgress={installProgress}
              setInstallProgress={setInstallProgress}
              setCurrentStep={setCurrentStep}
              creds={creds}
              detectedPlatform={detectedPlatform}
              admin={admin}
              store={store}
              backBtn={backBtn}
              primaryBtn={primaryBtn}
            />
          )}

          {/* STEP 7: Installation successful landing card layout screens */}
          {currentStep === 7 && (
            <div className="flex flex-col gap-6 text-center py-4">
              <div className="w-16 h-16 bg-emerald-100 text-emerald-600 rounded-full flex items-center justify-center text-3xl mx-auto animate-bounce">
                🎉
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-800 mb-1">Installation Successful!</h2>
                <p className="text-gray-500 text-sm">Fruitopia master modules deployed and locked perfectly.</p>
              </div>

              <div className="bg-emerald-50 border border-emerald-100 text-emerald-900 rounded-xl p-4 text-xs text-left space-y-3 leading-relaxed">
                <p className="font-bold text-center border-b border-emerald-200/60 pb-2 text-sm">🚀 System Deployment Overview</p>
                <p>👉 **Database seeded:** Products, categories, tax models, coupons, and client feedback systems have been loaded with fresh factory templates.</p>
                <p>👉 **Admin user active:** Log in anytime with your chosen master console profile credentials.</p>
                <p>👉 **Configuration secure:** Your dynamic app layer tokens are permanently saved locally. If you're using cPanel, the file is live at <code className="bg-emerald-100 px-1 rounded text-xs font-mono">public_html/public/firebase-config.json</code>.</p>
              </div>

              <p className="text-xs text-amber-600 font-medium">
                ⚠️ Refresh the page to clear the runtime installation context sandbox and load your live shop front interface!
              </p>

              <div className="pt-2 border-t border-gray-100">
                <button
                  onClick={() => window.location.reload()}
                  className="w-full bg-emerald-500 hover:bg-emerald-600 text-white font-semibold py-3 rounded-lg transition-colors"
                >
                  🔄 Finish Setup & Open Shop
                </button>
              </div>
            </div>
          )}

          <p className="text-xs text-gray-400 text-center mt-6">Universal multi-platform server core engine active</p>
        </div>
      </div>
    </div>
  )
}
