import { InputMode, switchInputMode, watchInputMode, defaultInputMode } from '../core/input'
import { getWindowContainerElement, activeWindow } from '../core/windows'
import { action, feedkeys, getColor, jumpTo } from '../core/neovim'
import { genList, merge } from '../support/utils'
import { Specs } from '../core/canvas-window'
import { cursor } from '../core/cursor'
import { makel } from '../ui/vanilla'
import { paddingV } from '../ui/css'
import * as grid from '../core/grid'

interface CellPosition {
  row: number
  col: number
}

interface FindPosOpts extends Specs {
  fg?: string
  bg?: string
}

const jumpKeys = 'ASDFLGHQWERTYUIOPBNMCBVJK'
// TODO: UHH CAREFUL I NOTICED DUPLICATES HERE LOL

// TODO: generate more ergonomic labels
// for example, 'sw' is harder to type than 'ad'
// also multi-hand might be better. aka 'aj' > 'ad'
// perhaps we can also create some convention for
// motions that go up vs down. e.g. if first label char...
//  - starts on left hand: motion is down
//  - starts on right hand: motion is up
// not sure if this makes things faster?
const jumpLabels = jumpKeys.split('').map(key => {
  const otherKeys = jumpKeys.replace(key, '')
  return otherKeys.split('').map(k => key + k)
}).reduce((res, grp) => [...res, ...grp])

action('divination', () => {
  const winContainer = getWindowContainerElement(cursor.row, cursor.col) as HTMLElement
  const win = activeWindow()
  if (!win || !winContainer) throw new Error('no window found for divination purposes lol wtf')

  const { height: rowCount, row } = win.getSpecs()
  // TODO: don't render on the current line. account for missing in jumpDistance calcs?
  const rowPositions = genList(rowCount, ix => win.relativeRowToY(ix))
  const relativeCursorRow = cursor.row - row

  const labelContainer = makel('div', {
    position: 'absolute'
  })

  const labels = rowPositions.map((y, ix) => {
    const el = makel('div', {
      ...paddingV(4),
      position: 'absolute',
      fontSize: '1.1rem',
      top: `${y}px`,
      left: '8px',
      background: '#000',
      color: '#eee',
    })

    const label = jumpLabels[ix]
    // using margin-right instead of letter-spacing because letter-spacing adds space
    // to the right of the last letter - so it ends up with more padding on the right :/
    el.innerHTML = `<span style="margin-right: 2px">${label[0]}</span><span>${label[1]}</span>`
    return el
  })

  labels.forEach(label => labelContainer.appendChild(label))
  winContainer.appendChild(labelContainer)

  const updateLabels = (matchChar: string) => labels
    .filter(m => (m.children[0] as HTMLElement).innerText.toLowerCase() === matchChar)
    .forEach(m => merge((m.children[0] as HTMLElement).style, {
      // TODO: inherit from colorscheme
      color: '#ff007c'
    }))

  switchInputMode(InputMode.Motion)
  const grabbedKeys: string[] = []

  const reset = () => {
    stopWatchingInput()
    winContainer.removeChild(labelContainer)
    defaultInputMode()
  }

  const joinTheDarkSide = () => {
    const jumpLabel = grabbedKeys.join('').toUpperCase()

    const targetRow = jumpLabels.indexOf(jumpLabel)
    const jumpDistance = targetRow - relativeCursorRow
    const jumpMotion = jumpDistance > 0 ? 'j' : 'k'
    feedkeys(`${Math.abs(jumpDistance)}g${jumpMotion}^`, 'n')

    reset()
  }

  const stopWatchingInput = watchInputMode(InputMode.Motion, keys => {
    if (keys === '<Esc>') return reset()

    grabbedKeys.push(keys)
    if (grabbedKeys.length === 1) return updateLabels(keys)
    if (grabbedKeys.length === 2) joinTheDarkSide()
  })
})

const findSearchPositions = ({ row, col, height, width, bg }: FindPosOpts) => {
  const maxRow = row + height
  const maxCol = col + width

  let lastCellWasARegularCell = true
  const searchPositions: CellPosition[] = []

  for (let rowIx = row; rowIx < maxRow; rowIx++) {
    for (let colIx = col; colIx < maxCol; colIx++) {
      const [ /*char*/, /*cellFg*/, cellBg ] = grid.get(rowIx, colIx)
      // TODO: don't know if this will ever be good with trying
      // to match search highlights from color information noly
      // ( see below for more comments )
      const isSearchCell = cellBg === bg
      // const isSearchCell = cellFg === fg && cellBg === bg 

      if (lastCellWasARegularCell && isSearchCell) {
        searchPositions.push({ row: rowIx, col: colIx })
        lastCellWasARegularCell = false
      }

      if (!isSearchCell) lastCellWasARegularCell = true
    }
  }

  return searchPositions
}

action('blarg', async () => {
  // TODO: type this return in the api fn
  const winContainer = getWindowContainerElement(cursor.row, cursor.col) as HTMLElement
  const win = activeWindow()
  // TODO: better msg pls
  if (!win || !winContainer) throw new Error('no window found for divination purposes lol wtf')

  const { foreground, background } = await getColor('Search')
  const specs = win.getSpecs()
  const searchPositions = findSearchPositions({
    ...specs,
    // TODO: this is a real shit way of doing it. getColor returns
    // us the color defined in the colorscheme. color can be reversed
    // but we don't know if it is reversed or not and how to compare.
    // also if we specify a color as NONE, getColor will return
    // some default value (#000 observed) but the rendered color
    // inherits the color from somewhere else

    // background and foreground are swapped in vim colorscheme
    // for Search highlight group (because of gui=reverse)
    fg: background,
    bg: foreground,
  })

  const searchPixelPositions = searchPositions.map(m => ({
    ...m,
    ...win.realtivePositionToPixels(m.row, m.col),
  }))

  const labelContainer = makel('div', { position: 'absolute' })
  const jumpTargets = new Map()

  const labels = searchPixelPositions.map((pos, ix) => {
    // TODO: these styles should be shared. also i think we should use css translate
    // instead of top/left
    const el = makel('div', {
      ...paddingV(4),
      position: 'absolute',
      // TODO: this font-size depends on global font-size + line-height
      // may need to figure out a good way to determine the largest font-size
      // that we can display without overlapping!
      fontSize: '1.3rem',
      top: `${pos.y}px`,
      left: `${pos.x}px`,
      background: '#000',
      color: '#eee',
    })

    const label = jumpLabels[ix]
    // TODO: either need absolute position in buffer (this is relative to render window)
    // or we to use relative jump motion like gj gk | like we did for the line jump divination
    jumpTargets.set(label, { row: pos.row, col: pos.col })
    // using margin-right instead of letter-spacing because letter-spacing adds space
    // to the right of the last letter - so it ends up with more padding on the right :/
    el.innerHTML = `<span style="margin-right: 2px">${label[0]}</span><span>${label[1]}</span>`
    return el
  })

  // TODO: dedup some of this code for label creation
  labels.forEach(label => labelContainer.appendChild(label))
  winContainer.appendChild(labelContainer)

  const updateLabels = (matchChar: string) => labels
    .filter(m => (m.children[0] as HTMLElement).innerText.toLowerCase() === matchChar)
    .forEach(m => merge((m.children[0] as HTMLElement).style, {
      // TODO: inherit from colorscheme
      color: '#ff007c'
    }))

  switchInputMode(InputMode.Motion)
  const grabbedKeys: string[] = []

  const reset = () => {
    stopWatchingInput()
    winContainer.removeChild(labelContainer)
    defaultInputMode()
  }

  const joinTheDarkSide = () => {
    const jumpLabel = grabbedKeys.join('').toUpperCase()
    const { row, col } = jumpTargets.get(jumpLabel)
    jumpTo({ line: row, column: col })

    reset()
  }

  const stopWatchingInput = watchInputMode(InputMode.Motion, keys => {
    if (keys === '<Esc>') return reset()

    grabbedKeys.push(keys)
    if (grabbedKeys.length === 1) return updateLabels(keys)
    if (grabbedKeys.length === 2) joinTheDarkSide()
  })
})
