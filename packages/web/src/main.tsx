import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from './router'
import { registerPwaRefresh } from './pwa'
import './index.css'
import App from './App'

registerPwaRefresh()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <App />
    </BrowserRouter>
  </StrictMode>,
)
