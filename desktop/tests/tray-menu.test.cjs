const assert = require('node:assert/strict')
const test = require('node:test')

const { buildTrayMenuTemplate } = require('../dist/tray-menu.js')

test('tray menu uses the native two-row MyAiLibrary layout', () => {
  let opened = 0
  let quit = 0
  const template = buildTrayMenuTemplate({
    open: () => { opened += 1 },
    quit: () => { quit += 1 },
  })

  assert.deepEqual(template.map((item) => item.label), [
    'Open MyAiLibrary',
    'Quit MyAiLibrary',
  ])
  assert.equal(template.some((item) => item.type === 'separator'), false)

  template[0].click()
  template[1].click()
  assert.equal(opened, 1)
  assert.equal(quit, 1)
})
