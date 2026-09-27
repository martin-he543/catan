import { Link, NavLink, Route, Routes, useLocation } from 'react-router-dom'
import { Home } from './pages/Home'
import { Generator } from './pages/Generator'

const NAV = [
  { to: '/', label: 'Resources', end: true },
  { to: '/board', label: 'Board generator', end: false },
]

function Header() {
  return (
    <header className="sticky top-0 z-40 border-b border-white/10 bg-sea-950/70 backdrop-blur-md">
      <div className="mx-auto flex max-w-7xl items-center gap-3 px-4 py-3 sm:gap-6 lg:px-8">
        <Link to="/" className="shrink-0 font-display font-bold tracking-tight whitespace-nowrap">
          Catan <span className="text-sea-400" aria-hidden>⬢</span>
        </Link>
        <nav className="flex gap-1 text-sm" aria-label="Main">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.end}
              className={({ isActive }) =>
                `rounded-lg px-2.5 py-1.5 whitespace-nowrap transition sm:px-3 ${
                  isActive ? 'bg-white/10 text-white' : 'text-sea-200 hover:bg-white/5'
                }`
              }
            >
              {item.label}
            </NavLink>
          ))}
        </nav>
        <a
          href="https://github.com/martin-he543"
          target="_blank"
          rel="noreferrer"
          className="ml-auto shrink-0 text-sm text-sea-200 transition hover:text-white"
        >
          GitHub
        </a>
      </div>
    </header>
  )
}

function NotFound() {
  const { pathname } = useLocation()
  return (
    <div className="mx-auto max-w-2xl px-4 py-24 text-center">
      <h1 className="font-display text-4xl font-bold">Off the edge of the board</h1>
      <p className="mt-3 text-sea-100/70">
        Nothing lives at <code className="rounded bg-white/10 px-1.5 py-0.5">{pathname}</code>.
      </p>
      <Link
        to="/"
        className="mt-8 inline-block rounded-xl bg-sea-400 px-5 py-3 font-display font-semibold text-sea-950"
      >
        Back to shore
      </Link>
    </div>
  )
}

export default function App() {
  return (
    <div className="flex min-h-dvh flex-col">
      <Header />
      <main className="flex-1">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/board" element={<Generator />} />
          <Route path="*" element={<NotFound />} />
        </Routes>
      </main>
      <footer className="border-t border-white/10 px-4 py-6 text-center text-xs text-sea-200 lg:px-8">
        Board generator originally forked from{' '}
        <a
          href="https://github.com/dado3212"
          target="_blank"
          rel="noreferrer"
          className="underline underline-offset-2 hover:text-white"
        >
          Alex Beals
        </a>
        . Catan is a trademark of its respective owners; this is a fan-made helper.
      </footer>
    </div>
  )
}
