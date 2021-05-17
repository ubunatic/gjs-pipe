
gi = imports.gi
const { Gio, GLib } = gi

/** @type {import('../lib/gjspipe/pipe.js')} */
const { Pipe, AGG, setTimeout, clearTimeout, asyncTimeout } = imports.gjspipe.pipe

let prog = imports.system.programInvocationName
let here = GLib.path_get_dirname(prog)
let loop = GLib.MainLoop.new(null, false)
let finished = []
let errors = []
function error(e) { errors.push(e) }

function OK() {
    return 'OK'
}

function Throw() {
    throw new Error('Error!')
}

async function runTests() {
    log(`run tests`)
    let v1 = await asyncTimeout(OK)
    if (v1 != 'OK') error(new Error('bad promise result 1'))
    let v2 = await asyncTimeout(OK)
    if (v2 != 'OK') error(new Error('bad promise result 2'))
    log(`await tests OK`)

    let thrown = null
    try { await asyncTimeout(Throw) }
    catch (e) { thrown = e }
    if (thrown == null) error( new Error('missing promise error'))
    log(`error tests OK`)
}

runTests().then(() => loop.quit())

loop.run()
if (errors.length > 0) {
    errors.map(logError)
    throw new Error(`async tests failed`)
}
