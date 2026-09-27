import { Route, Routes } from 'react-router-dom'
import { CreateGame } from '../game/pages/CreateGame'
import { LocalGamePage } from '../game/pages/LocalGame'
import { OnlineGamePage } from '../game/pages/OnlineGame'
import { PlayHome } from '../game/pages/PlayHome'
import { ReplayPage } from '../game/pages/Replay'

/** Everything under /play, loaded as its own chunk so the other pages stay light. */
export default function Play() {
  return (
    <Routes>
      <Route index element={<PlayHome />} />
      <Route path="new" element={<CreateGame />} />
      <Route path="local/:id" element={<LocalGamePage />} />
      <Route path="g/:code" element={<OnlineGamePage />} />
      <Route path="replay/local/:id" element={<ReplayPage source="local" />} />
      <Route path="replay/g/:id" element={<ReplayPage source="online" />} />
    </Routes>
  )
}
