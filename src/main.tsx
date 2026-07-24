import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './index.css'
import { AuthProvider } from './context/AuthContext'
import { CoursesProvider } from './context/CoursesContext'
import { PurchaseProvider } from './context/PurchaseContext'
import { NotificationsProvider } from './context/NotificationsContext'

// Раньше SCORM-пакеты проигрывались через service worker (scorm-sw.js) — файлы
// лежали в Cache Storage браузера. Теперь пакеты хранятся на сервере, а SW
// стал вредным: он перехватывает /scorm-store/ и не умеет отдавать странице
// ответы-редиректы, которыми раздаются крупные файлы (>4,5 МБ), — из-за этого
// такие ассеты не грузятся и плеер остаётся пустым. Поэтому удаляем ранее
// установленный воркер и его кэш у всех, кто уже открывал сайт.
if ('serviceWorker' in navigator) {
  navigator.serviceWorker
    .getRegistrations()
    .then((regs) => regs.forEach((r) => r.unregister()))
    .catch(() => {})
  if ('caches' in window) {
    caches.delete('scorm-packages').catch(() => {})
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <BrowserRouter>
      <AuthProvider>
        <CoursesProvider>
          <PurchaseProvider>
            <NotificationsProvider>
              <App />
            </NotificationsProvider>
          </PurchaseProvider>
        </CoursesProvider>
      </AuthProvider>
    </BrowserRouter>
  </React.StrictMode>,
)
