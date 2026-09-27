import { describe, expect, it } from 'vitest'
import { parseSettings } from '../firebase'
import { isCode, newCode, summarise } from '../protocol'
import { newGame } from '../../engine/__tests__/simulate'

describe('pasting a firebaseConfig', () => {
  it('reads the JavaScript snippet the console shows', () => {
    const settings = parseSettings(`
      // Import the functions you need from the SDKs you need
      const firebaseConfig = {
        apiKey: "AIzaFAKE",
        authDomain: 'catan-1.firebaseapp.com',
        projectId: "catan-1",
        storageBucket: "catan-1.firebasestorage.app",
        messagingSenderId: "123",
        appId: "1:123:web:abc",
      };`)
    expect(settings).toMatchObject({
      apiKey: 'AIzaFAKE',
      authDomain: 'catan-1.firebaseapp.com',
      projectId: 'catan-1',
      appId: '1:123:web:abc',
      authority: 'client',
    })
  })

  it('reads plain JSON, and fills in the auth domain', () => {
    const settings = parseSettings('{"apiKey":"k","projectId":"p","appId":"a"}')
    expect(settings?.authDomain).toBe('p.firebaseapp.com')
  })

  it('refuses anything without a key and a project', () => {
    expect(parseSettings('hello')).toBeNull()
    expect(parseSettings('{"apiKey":"k"}')).toBeNull()
  })
})

describe('game codes', () => {
  it('are six characters that read aloud cleanly', () => {
    for (let i = 0; i < 200; i++) {
      const code = newCode()
      expect(isCode(code)).toBe(true)
      expect(code).not.toMatch(/[01OI]/)
    }
  })

  it('summarise a state for the lobby lists', () => {
    const { state } = newGame('classic', 3)
    expect(summarise(state)).toMatchObject({ status: 'playing', waiting: [0], winner: null, seq: 0 })
  })
})
