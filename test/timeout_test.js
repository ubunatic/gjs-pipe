
gi = imports.gi
const { Gio, GLib } = gi

const { Pipe, AGG_JSON, setTimeout, clearTimeout, asyncTimeout } = imports.gjspipe.pipe

let program = imports.system.programInvocationName
let here = GLib.path_get_dirname(program)

let loop = GLib.MainLoop.new(null, false)
let finished = []
let err = null

function OK() {
    return 'OK'
}

function Throw() {
    throw new Error('Error!')
}

async function runTests() {
    let v1 = await asyncTimeout(OK)
    if (v1 != 'OK') err = new Error('bad promise result 1')
    let v2 = await asyncTimeout(OK)
    if (v2 != 'OK') err = new Error('bad promise result 2')
    log(`await tests OK`)

    let thrown = null
    try { await asyncTimeout(Throw) }
    catch (e) { thrown = e }
    if (thrown == null) err = new Error('missing promise error')
    log(`error tests OK`)
}

runTests().then(() => loop.quit())

loop.run()
if (err) throw err