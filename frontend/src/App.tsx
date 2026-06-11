import React from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import Layout from './components/Layout'
import Dashboard from './pages/Dashboard'
import Documents from './pages/Documents'
import ManualReview from './pages/ManualReview'
import Suppliers from './pages/Suppliers'
import Settings from './pages/Settings'
import Reports from './pages/Reports'

export default function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Layout />}>
          <Route index element={<Dashboard />} />
          <Route path="dokumente" element={<Documents />} />
          <Route path="prüfung" element={<ManualReview />} />
          <Route path="prüfung/:id" element={<ManualReview />} />
          <Route path="lieferanten" element={<Suppliers />} />
          <Route path="einstellungen" element={<Settings />} />
          <Route path="berichte" element={<Reports />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  )
}
