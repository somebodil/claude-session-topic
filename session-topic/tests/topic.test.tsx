import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'
import type { Engine, MockClock } from 'claude-code/testing'

const BAND = {
  plugin: 'session-topic',
  component: 'AbovePrompt',
  requestId: 'band',
  surface: 'terminal',
  props: {
    hasSurvey: false,
    isCollapsed: false,
    isWorking: false,
    maxRows: 10,
    bodyColumns: 80,
    scroll: { offset: 0, bodyRows: 10 },
    view: {},
  },
} as const

const USAGE = {
  input_tokens: 1,
  output_tokens: 1,
  cache_read_input_tokens: 0,
  cache_creation_input_tokens: 0,
}

const TURN = { durationMs: 1, isAborted: false, reason: 'answer' } as const

const answered = (text: string) => ({
  value: { isAnswered: true as const, text, usage: USAGE },
})

const failed = () => ({
  value: {
    isAnswered: false as const,
    reason: 'api-error' as const,
    status: 529,
    error: 'overloaded' as const,
    usage: USAGE,
  },
})

type Reply = ReturnType<typeof answered> | ReturnType<typeof failed>

// What the engine beneath the mod holds and answers in a test.
type World = {
  surfaces: readonly 'terminal'[]
  rows: { role: 'user' | 'assistant'; text: string }[]
  reply: () => Reply | Promise<Reply>
  /** What becomes of a submitted prompt beneath the mod */
  enter: (text: string) => { text: string } | { drop: string }
  /** The prompts of the requests the mod made */
  prompts: string[]
  /** What the mod asked the transcript for */
  asked: { last?: number }[]
}

const world = (rows: World['rows'] = [{ role: 'user', text: 'Parquet 정리' }]): World => ({
  surfaces: ['terminal'],
  rows,
  reply: () => answered('Parquet 정리'),
  enter: text => ({ text }),
  prompts: [],
  asked: [],
})

// Stands for the engine: every hook here sits beneath the mod.
const stand = (on: On, w: World) => {
  on('session.surfaces', () => ({ value: w.surfaces }))
  on('session.messages', (_, e) => {
    w.asked.push(e)

    return { value: w.rows.map(row => ({ ...row, toolUses: [] })) }
  })
  on('model.complete', (_, e) => {
    w.prompts.push(e.prompt)

    return w.reply()
  })
  on('prompt.submit', (_, e) => w.enter(e.text))
  on('turn.complete', (_, e) => ({ text: e.answer }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  // What is drawn where the mod leaves the band to the engine.
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)

    return <Text>engine</Text>
  })
}

// The words of the first Text of the band that match, if any.
const band = async ($: Engine, pattern: RegExp, hasSurvey = false) => {
  const ui = await $.ui.mount({ ...BAND, props: { ...BAND.props, hasSurvey } })
  const found = await ui.find({ type: 'Text', text: pattern })
  await ui.unmount()

  return found?.text
}

const until = async (clock: MockClock, isDone: () => boolean) => {
  for (let i = 0; i < 50 && !isDone(); i++) {
    await clock.advance(1)
  }
}

const settle = async (clock: MockClock) => {
  for (let i = 0; i < 5; i++) {
    await clock.advance(1)
  }
}

// True if a text holds half of a character that takes two units.
const hasBrokenCharacter = (text: string) => {
  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i)

    if (code >= 0xd800 && code <= 0xdbff) {
      const next = text.charCodeAt(i + 1)

      if (!(next >= 0xdc00 && next <= 0xdfff)) {
        return true
      }

      i++
    } else if (code >= 0xdc00 && code <= 0xdfff) {
      return true
    }
  }

  return false
}

test('the band follows the conversation', async ($, on) => {
  const clock = mock.clock(on)
  const w = world([
    { role: 'user', text: '<system-reminder>noise</system-reminder>pull 충돌 해결해' },
    { role: 'assistant', text: '해결했습니다.' },
  ])
  w.reply = () => answered('"Git 충돌 해결".')
  stand(on, w)

  // Nothing known yet: the mod leaves the band to the engine.
  expect(await band($, /engine/)).toBe('engine')

  await $.prompt.submit({
    text: '세션 주제를 화면에 띄울 수 있어?',
    wait: false,
    origin: { kind: 'composer' },
  })
  await clock.advance(1)

  expect(await band($, /Git/)).toBe('Git 충돌 해결')
  expect(await band($, /주제/)).toBe('주제 · ')

  // The request carried the cleaned transcript, the new prompt and no label,
  // and only the newest rows of the transcript were read for it.
  expect(w.prompts[0]).toContain('User: pull 충돌 해결해')
  expect(w.prompts[0]).toContain('Assistant: 해결했습니다.')
  expect(w.prompts[0]).not.toContain('noise')
  expect(w.prompts[0]).toContain('User: 세션 주제를 화면에 띄울 수 있어?')
  expect(w.prompts[0]).toContain('Current label: (none yet)')
  expect(w.asked[0]?.last).toBe(200)

  // A later turn moves the label, and the request names the one shown.
  w.reply = () => answered('세션 주제 표시')
  await $.turn.complete({ ...TURN, answer: '가능합니다.', turnId: 't1' })
  await clock.advance(1)

  expect(await band($, /세션/)).toBe('세션 주제 표시')
  expect(w.prompts[1]).toContain('Current label: Git 충돌 해결')
})

test('a failed request keeps the label already shown', async ($, on) => {
  const clock = mock.clock(on)
  const w = world()
  stand(on, w)

  await $.turn.complete({ ...TURN, answer: 'a', turnId: 't1' })
  await clock.advance(1)
  w.reply = failed
  await $.turn.complete({ ...TURN, answer: 'b', turnId: 't2' })
  await clock.advance(1)

  expect(w.prompts.length).toBe(2)
  expect(await band($, /Parquet/)).toBe('Parquet 정리')
})

test('a session that draws nowhere asks no model', async ($, on) => {
  const clock = mock.clock(on)
  const w = world()
  // What `claude -p` and the SDK answer: there is no band to fill.
  w.surfaces = []
  stand(on, w)

  await $.session.start({ cwd: '/', surface: null, isInteractive: false })
  await $.prompt.submit({ text: 'Parquet 정리', wait: false, origin: { kind: 'sdk' } })
  await $.turn.complete({ ...TURN, answer: 'a', turnId: 't1' })
  await settle(clock)

  expect(w.prompts.length).toBe(0)
})

test('a session that starts with a conversation in it is labelled', async ($, on) => {
  const clock = mock.clock(on)
  const w = world()
  stand(on, w)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await clock.advance(1)

  expect(await band($, /Parquet/)).toBe('Parquet 정리')
})

test('a session that starts empty asks no model', async ($, on) => {
  const clock = mock.clock(on)
  const w = world([])
  stand(on, w)

  await $.session.start({ cwd: '/', surface: 'terminal', isInteractive: true })
  await settle(clock)

  expect(w.prompts.length).toBe(0)
})

test('only the words of the person refresh the label when a prompt is submitted', async ($, on) => {
  const clock = mock.clock(on)
  const w = world([])
  w.reply = () => answered('배포 점검')
  stand(on, w)

  // Another session, a task and a schedule are not the person.
  await $.prompt.submit({ text: 'from a peer', wait: false, origin: { kind: 'peer' } })
  await $.prompt.submit({ text: 'from a task', wait: false, origin: { kind: 'task-notification' } })
  await $.prompt.submit({ text: 'from a schedule', wait: false, origin: { kind: 'scheduled-trigger' } })
  // Nor is a slash command, or a prompt the person does not see as typed.
  await $.prompt.submit({
    text: '/compact',
    wait: false,
    origin: { kind: 'composer' },
    command: { name: 'compact', args: '' },
  })
  await $.prompt.submit({ text: 'a notice', wait: false, origin: { kind: 'composer' }, isMeta: true })
  await settle(clock)
  expect(w.prompts.length).toBe(0)

  // Typed in an app that hosts the session, sent through Remote Control or
  // sent from Slack: each is.
  await $.prompt.submit({ text: '앱에서 보낸 말', wait: false, origin: { kind: 'sdk' } })
  await settle(clock)
  await $.prompt.submit({ text: '배포 상태 확인해', wait: false, origin: { kind: 'bridge' } })
  await settle(clock)
  await $.prompt.submit({ text: '슬랙에서 보낸 말', wait: false, origin: { kind: 'slack-ping' } })
  await settle(clock)

  expect(w.prompts.length).toBe(3)
  expect(w.prompts[0]).toContain('User: 앱에서 보낸 말')
  expect(w.prompts[1]).toContain('User: 배포 상태 확인해')
  expect(w.prompts[2]).toContain('User: 슬랙에서 보낸 말')
})

test('a prompt that was dropped goes nowhere, and a rewritten one is sent as rewritten', async ($, on) => {
  const clock = mock.clock(on)
  const w = world([])
  w.reply = () => answered('배포 점검')
  // A guard beneath the mod: it drops a prompt with a key and masks a name.
  w.enter = text =>
    text.includes('KEY') ? { drop: 'holds a key' } : { text: text.replace('Kim', '***') }
  stand(on, w)

  await $.prompt.submit({ text: 'KEY=abc 로 배포해', wait: false, origin: { kind: 'composer' } })
  await settle(clock)
  expect(w.prompts.length).toBe(0)

  await $.prompt.submit({ text: 'Kim 에게 배포 알려', wait: false, origin: { kind: 'composer' } })
  await settle(clock)
  expect(w.prompts.length).toBe(1)
  expect(w.prompts[0]).toContain('User: *** 에게 배포 알려')
  expect(w.prompts[0]).not.toContain('Kim')
})

test('only an answer of the main conversation refreshes the label when a turn completes', async ($, on) => {
  const clock = mock.clock(on)
  const w = world()
  stand(on, w)

  // A subagent's answer, an interrupted turn and a turn that ended in an error.
  await $.turn.complete({ ...TURN, answer: 'a', turnId: 't1', agentId: 'agent-1' })
  await $.turn.complete({ ...TURN, answer: '', turnId: 't2', isAborted: true, reason: 'aborted' })
  await $.turn.complete({ ...TURN, answer: '', turnId: 't3', reason: 'error' })
  await settle(clock)
  expect(w.prompts.length).toBe(0)

  await $.turn.complete({ ...TURN, answer: 'b', turnId: 't4' })
  await settle(clock)
  expect(w.prompts.length).toBe(1)
})

test('a /clear takes the label down, and a late reply does not bring it back', async ($, on) => {
  const clock = mock.clock(on)
  const w = world()
  stand(on, w)

  await $.turn.complete({ ...TURN, answer: 'a', turnId: 't1' })
  await clock.advance(1)
  expect(await band($, /Parquet/)).toBe('Parquet 정리')

  // A request is on its way when the conversation is cleared.
  const waiting: ((reply: Reply) => void)[] = []
  w.reply = () => new Promise<Reply>(resolve => waiting.push(resolve))
  await $.turn.complete({ ...TURN, answer: 'b', turnId: 't2' })
  await until(clock, () => waiting.length === 1)

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } })
  expect(await band($, /Parquet/)).toBeUndefined()

  waiting[0]?.(answered('지난 대화'))
  await settle(clock)
  expect(await band($, /Parquet/)).toBeUndefined()
  expect(await band($, /지난/)).toBeUndefined()
})

test('a reply that comes in after a newer one was used is dropped', async ($, on) => {
  const clock = mock.clock(on)
  const w = world()
  const waiting: ((reply: Reply) => void)[] = []
  w.reply = () => new Promise<Reply>(resolve => waiting.push(resolve))
  stand(on, w)

  await $.prompt.submit({ text: '먼저 보낸 말', wait: false, origin: { kind: 'composer' } })
  await until(clock, () => waiting.length === 1)
  await $.turn.complete({ ...TURN, answer: 'a', turnId: 't1' })
  await until(clock, () => waiting.length === 2)

  waiting[1]?.(answered('새 라벨'))
  await settle(clock)
  waiting[0]?.(answered('옛 라벨'))
  await settle(clock)

  expect(await band($, /라벨/)).toBe('새 라벨')
})

test('an older reply is still used when the newer request failed', async ($, on) => {
  const clock = mock.clock(on)
  const w = world()
  const waiting: ((reply: Reply) => void)[] = []
  w.reply = () => new Promise<Reply>(resolve => waiting.push(resolve))
  stand(on, w)

  await $.prompt.submit({ text: '먼저 보낸 말', wait: false, origin: { kind: 'composer' } })
  await until(clock, () => waiting.length === 1)
  await $.turn.complete({ ...TURN, answer: 'a', turnId: 't1' })
  await until(clock, () => waiting.length === 2)

  waiting[1]?.(failed())
  await settle(clock)
  waiting[0]?.(answered('옛 라벨'))
  await settle(clock)

  expect(await band($, /라벨/)).toBe('옛 라벨')
})

test('eight messages are sent at most, the prompt among them', async ($, on) => {
  const clock = mock.clock(on)
  const w = world(
    Array.from({ length: 12 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('assistant' as const),
      text: `message ${i + 1}.`,
    })),
  )
  stand(on, w)

  await $.prompt.submit({ text: 'the new prompt', wait: false, origin: { kind: 'composer' } })
  await settle(clock)

  const sent = (w.prompts[0] ?? '').split('\n').filter(line => /^(User|Assistant): /.test(line))
  expect(sent.length).toBe(8)
  expect(sent[0]).toBe('Assistant: message 6.')
  expect(sent[7]).toBe('User: the new prompt')
})

test('a long message is cut without splitting an emoji', async ($, on) => {
  const clock = mock.clock(on)
  // The emoji takes two units and lies across the place of the cut.
  const w = world([{ role: 'user', text: `${'a'.repeat(499)}😀 and more` }])
  stand(on, w)

  await $.turn.complete({ ...TURN, answer: 'a', turnId: 't1' })
  await settle(clock)

  expect(w.prompts[0]).toContain(`User: ${'a'.repeat(499)} ...`)
  expect(hasBrokenCharacter(w.prompts[0] ?? '')).toBe(false)
})

test('a reply cannot carry hidden characters to the band', async ($, on) => {
  const clock = mock.clock(on)
  const escape = String.fromCharCode(27)
  const bell = String.fromCharCode(7)
  const turnAround = String.fromCharCode(0x202e)
  const w = world()
  w.reply = () => answered(`${escape}[31mGit ${turnAround}충돌${bell}`)
  stand(on, w)

  await $.turn.complete({ ...TURN, answer: 'a', turnId: 't1' })
  await settle(clock)

  expect(await band($, /Git/)).toBe('[31mGit 충돌')
})

test('a label is taken out of quotes but keeps a bracket of its own', async ($, on) => {
  const clock = mock.clock(on)
  const w = world()
  stand(on, w)

  w.reply = () => answered('「Fix parseArgs()」.')
  await $.turn.complete({ ...TURN, answer: 'a', turnId: 't1' })
  await settle(clock)
  expect(await band($, /Fix/)).toBe('Fix parseArgs()')

  w.reply = () => answered('[WIP] arr[0]')
  await $.turn.complete({ ...TURN, answer: 'b', turnId: 't2' })
  await settle(clock)
  expect(await band($, /WIP/)).toBe('[WIP] arr[0]')
})

test('a label that is too long is cut', async ($, on) => {
  const clock = mock.clock(on)
  const w = world()
  w.reply = () => answered('b'.repeat(60))
  stand(on, w)

  await $.turn.complete({ ...TURN, answer: 'a', turnId: 't1' })
  await settle(clock)

  expect(await band($, /b/)).toBe(`${'b'.repeat(39)}…`)
})

test('the band is left to a survey', async ($, on) => {
  const clock = mock.clock(on)
  const w = world()
  stand(on, w)

  await $.turn.complete({ ...TURN, answer: 'a', turnId: 't1' })
  await settle(clock)

  expect(await band($, /Parquet/)).toBe('Parquet 정리')
  expect(await band($, /Parquet/, true)).toBeUndefined()
})

test('the prefix option replaces the word in front of the label', { options: { prefix: 'Topic' } }, async ($, on) => {
  const clock = mock.clock(on)
  const w = world()
  stand(on, w)

  await $.turn.complete({ ...TURN, answer: 'a', turnId: 't1' })
  await settle(clock)

  expect(await band($, /Topic/)).toBe('Topic · ')
  expect(await band($, /주제/)).toBeUndefined()
  expect(await band($, /Parquet/)).toBe('Parquet 정리')
})
