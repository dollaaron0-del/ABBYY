import React, { useState } from 'react'
import { Outlet, NavLink, useLocation } from 'react-router-dom'

const NAV_ITEMS = [
  { path: '/', label: 'Dashboard', icon: '📊', exact: true },
  { path: '/dokumente', label: 'Dokumente', icon: '📄', exact: false },
  { path: '/prüfung', label: 'Manuelle Prüfung', icon: '🔍', exact: false },
  { path: '/lieferanten', label: 'Lieferanten', icon: '🏢', exact: false },
  { path: '/berichte', label: 'Berichte', icon: '📈', exact: false },
  { path: '/bot', label: 'Bot-Aktivität', icon: '🤖', exact: false },
  { path: '/einstellungen', label: 'Einstellungen', icon: '⚙️', exact: false },
]

const styles: Record<string, React.CSSProperties> = {
  shell: {
    display: 'flex',
    minHeight: '100vh',
    fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif',
    background: '#f0f2f5',
  },
  sidebar: {
    width: 240,
    minWidth: 240,
    background: 'linear-gradient(180deg, #1a3a5c 0%, #0d2438 100%)',
    color: '#fff',
    display: 'flex',
    flexDirection: 'column',
    boxShadow: '2px 0 8px rgba(0,0,0,0.2)',
    position: 'sticky' as const,
    top: 0,
    height: '100vh',
    overflowY: 'auto',
  },
  sidebarCollapsed: {
    width: 64,
    minWidth: 64,
  },
  brand: {
    padding: '24px 20px 20px',
    borderBottom: '1px solid rgba(255,255,255,0.1)',
  },
  brandTitle: {
    fontSize: 13,
    fontWeight: 700,
    color: '#d4a843',
    letterSpacing: '0.05em',
    textTransform: 'uppercase' as const,
    lineHeight: 1.3,
  },
  brandSub: {
    fontSize: 11,
    color: 'rgba(255,255,255,0.6)',
    marginTop: 4,
  },
  nav: {
    flex: 1,
    padding: '12px 0',
  },
  navLink: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    padding: '11px 20px',
    color: 'rgba(255,255,255,0.75)',
    textDecoration: 'none',
    fontSize: 14,
    fontWeight: 500,
    transition: 'background 0.15s, color 0.15s',
    borderLeft: '3px solid transparent',
    cursor: 'pointer',
  },
  navLinkActive: {
    background: 'rgba(212,168,67,0.15)',
    color: '#d4a843',
    borderLeft: '3px solid #d4a843',
  },
  navIcon: {
    fontSize: 18,
    width: 22,
    textAlign: 'center' as const,
    flexShrink: 0,
  },
  footer: {
    padding: '16px 20px',
    borderTop: '1px solid rgba(255,255,255,0.1)',
    fontSize: 11,
    color: 'rgba(255,255,255,0.4)',
  },
  main: {
    flex: 1,
    display: 'flex',
    flexDirection: 'column',
    overflow: 'auto',
    minWidth: 0,
  },
  topBar: {
    background: '#fff',
    borderBottom: '1px solid #e5e7eb',
    padding: '14px 28px',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    boxShadow: '0 1px 4px rgba(0,0,0,0.06)',
    position: 'sticky' as const,
    top: 0,
    zIndex: 10,
  },
  pageTitle: {
    fontSize: 16,
    fontWeight: 600,
    color: '#1a3a5c',
  },
  badge: {
    fontSize: 11,
    background: '#1a3a5c',
    color: '#fff',
    borderRadius: 12,
    padding: '2px 10px',
    letterSpacing: '0.03em',
  },
  content: {
    padding: 28,
    flex: 1,
  },
}

export default function Layout() {
  const location = useLocation()

  const activeItem = NAV_ITEMS.find((item) =>
    item.exact ? location.pathname === item.path : location.pathname.startsWith(item.path)
  ) || NAV_ITEMS[0]

  return (
    <div style={styles.shell}>
      <aside style={styles.sidebar}>
        <div style={styles.brand}>
          <div style={styles.brandTitle}>Althoff Hotels<br />&amp; Resorts</div>
          <div style={styles.brandSub}>Rechnungsvorfilterung</div>
        </div>

        <nav style={styles.nav}>
          {NAV_ITEMS.map((item) => (
            <NavLink
              key={item.path}
              to={item.path}
              end={item.exact}
              style={({ isActive }) => ({
                ...styles.navLink,
                ...(isActive ? styles.navLinkActive : {}),
              })}
            >
              <span style={styles.navIcon}>{item.icon}</span>
              <span>{item.label}</span>
            </NavLink>
          ))}
        </nav>

        <div style={styles.footer}>
          <div>ABBYY Rechnungsvorfilterung</div>
          <div style={{ marginTop: 2 }}>v1.0.0 · On-Premise</div>
        </div>
      </aside>

      <main style={styles.main}>
        <div style={styles.topBar}>
          <span style={styles.pageTitle}>
            {activeItem.icon} {activeItem.label}
          </span>
          <span style={styles.badge}>On-Premise · Kein externes Netzwerk</span>
        </div>

        <div style={styles.content}>
          <Outlet />
        </div>
      </main>
    </div>
  )
}
