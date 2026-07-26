/* eslint-disable react-refresh/only-export-components */
import {
  Children,
  Fragment,
  createContext,
  isValidElement,
  useContext,
  useEffect,
  useMemo,
  useState,
} from 'react'
import type { AnchorHTMLAttributes, ReactElement, ReactNode } from 'react'

type RouterContextValue = {
  pathname: string
  search: string
  navigate: (to: string, options?: { replace?: boolean }) => void
}

type RouteProps = {
  path: string
  element: ReactNode
}

const RouterContext = createContext<RouterContextValue | null>(null)

function getCurrentLocation() {
  return {
    pathname: window.location.pathname || '/',
    search: window.location.search,
  }
}

function useRouter() {
  const value = useContext(RouterContext)
  if (!value) {
    throw new Error('Router components must be rendered inside BrowserRouter.')
  }
  return value
}

export function BrowserRouter({ children }: { children: ReactNode }) {
  const [location, setLocation] = useState(getCurrentLocation)

  useEffect(() => {
    const handlePopState = () => setLocation(getCurrentLocation())
    window.addEventListener('popstate', handlePopState)
    return () => window.removeEventListener('popstate', handlePopState)
  }, [])

  const value = useMemo<RouterContextValue>(
    () => ({
      ...location,
      navigate: (to, options) => {
        const target = new URL(to, window.location.origin)
        if (target.pathname === window.location.pathname && target.search === window.location.search) {
          return
        }
        if (options?.replace) {
          window.history.replaceState(null, '', `${target.pathname}${target.search}${target.hash}`)
        } else {
          window.history.pushState(null, '', `${target.pathname}${target.search}${target.hash}`)
        }
        setLocation(getCurrentLocation())
      },
    }),
    [location],
  )

  return <RouterContext.Provider value={value}>{children}</RouterContext.Provider>
}

export function Route(props: RouteProps) {
  void props
  return null
}

function flattenRoutes(children: ReactNode): Array<ReactElement<RouteProps>> {
  const routes: Array<ReactElement<RouteProps>> = []
  Children.forEach(children, (child) => {
    if (!isValidElement(child)) {
      return
    }
    const element = child as ReactElement<{ children?: ReactNode }>
    if (element.type === Fragment) {
      routes.push(...flattenRoutes(element.props.children))
      return
    }
    routes.push(element as ReactElement<RouteProps>)
  })
  return routes
}

export function Routes({ children }: { children: ReactNode }) {
  const { pathname } = useRouter()
  const routes = flattenRoutes(children)
  const match = routes.find((route) => route.props.path === pathname || route.props.path === '*')
  return <>{match?.props.element ?? null}</>
}

export function Navigate({ to, replace = false }: { to: string; replace?: boolean }) {
  const { navigate } = useRouter()
  useEffect(() => {
    navigate(to, { replace })
  }, [navigate, replace, to])
  return null
}

export function useLocation() {
  const { pathname, search } = useRouter()
  return useMemo(() => ({ pathname, search }), [pathname, search])
}

export function useNavigate() {
  const { navigate } = useRouter()
  return navigate
}

type NavLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, 'className' | 'href'> & {
  className?: string | ((state: { isActive: boolean }) => string)
  to: string
}

export function NavLink({ className, to, onClick, ...props }: NavLinkProps) {
  const { navigate, pathname } = useRouter()
  const targetPathname = new URL(to, window.location.origin).pathname
  const isActive = targetPathname === '/' ? pathname === '/' : pathname === targetPathname
  const resolvedClassName = typeof className === 'function' ? className({ isActive }) : className

  return (
    <a
      {...props}
      className={resolvedClassName}
      href={to}
      onClick={(event) => {
        onClick?.(event)
        if (
          event.defaultPrevented ||
          event.button !== 0 ||
          event.metaKey ||
          event.altKey ||
          event.ctrlKey ||
          event.shiftKey
        ) {
          return
        }
        event.preventDefault()
        navigate(to)
      }}
    />
  )
}

export function useSearchParams() {
  const { search } = useRouter()
  return useMemo(() => [new URLSearchParams(search)] as const, [search])
}
