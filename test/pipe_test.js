
gi = imports.gi
const { Gio, GLib } = gi

const { Pipe, AGG_JSON, setTimeout, clearTimeout } = imports.gjspipe.pipe

let program = imports.system.programInvocationName
let here = GLib.path_get_dirname(program)

let bash = ['bash', '-o', 'errexit', '-o', 'pipefail', '-c']

function testPipes(num, done) {
    const Seconds = 1e6

    let ticks = 0
    let max_ticks = 1000

    let gpu_top = `for i in $(seq 100); do cat ${here}/intel_gpu_top.json; done`
    let script  = `for i in 1 2 3; do echo $i; done`  // sleep required to get output before exit
    let pipe1   = new Pipe(...bash, gpu_top).configure({agg_type: AGG_JSON})
    let pipe2   = new Pipe(...bash, script)

    pipe1.verbose = true
    pipe2.verbose = true

    let res = []
    let num_lines = 0
    let errors = []

    let onResult1 = (l) => res.push(l)
    let onResult2 = (l) => print('pipe2', num_lines++)
    let onExit = (ok) => {
        if (!ok) quit(new Error(`pipe failed`))
        // else: ignore direct exit since we have an async check pending
    }

    let quit = (e=null) => {
        if (e) logError(e)
        log(`quit testPipes`)
        cancel()
        done(num, e == null)
    }

    let tick = () => {
        // check whether to stop on error or continue processing
        if (ticks++ > max_ticks) return quit(new Error('pipes did not produce enough data'))
        if (res.length < 10)     return setTimeout(tick, 10)
        if (num_lines < 3)       return setTimeout(tick, 10)

        log(`got ${res.length} results after ${ticks} ticks`)
        if (!res[0].power)      return quit(new Error('gpu top has no power stats'))
        if (!res[0].power.unit) return quit(new Error('gpu top has no power unit'))
        if (!res[0].engines)    return quit(new Error('gpu top has no engines'))
        if (num_lines != 3)     return quit(new Error(`script produced ${num_lines} lines, expected 3 lines`))

        // pipes finished, results look good!
        quit()
    }

    let cancel1 = pipe1.start(onResult1, onExit)
    let cancel2 = pipe2.start(onResult2, onExit)
    let cancel = () => { cancel1(); cancel2() }
    log("pipes started")

    tick()

    return cancel
}

function testRestart(num, done) {    
    const Seconds = 1e6
    let ticks = 0
    let max_ticks = 1000
    let max_runs = 10

    let script = `while sleep 0.1; do echo 1; done`
    let pipe   = new Pipe('bash', '-c', script)

    let res = []
    let errors = []

    let quit = (e=null) => {
        if (e) logError(e)
        cancel()
        done(num, e == null)
    }

    let onExit = (ok) => {
        if (!ok) quit(new Error(`testRestart failed`))
        // else: ignore exit since other are still running
    }

    let onResult = (l) => res.push(l)
    let cancel = pipe.start(onResult, onExit)
    let runs = 1

    let restart = () => {
        cancel()
        log(`pipe ${runs}/${max_runs} finished`)
        runs++
        if (runs % 2 == 0) pipe.read_timeout_ms = 100
        else               pipe.read_timeout_ms = 0
        cancel = pipe.start(onResult, onExit)
        tick()
    }

    let tick = () => {        
        if (ticks++ > max_ticks) return quit(new Error('script did not produce enough data'))
        if (res.length < 2)      return setTimeout(tick, 10)
        if (runs > max_runs)     return quit()
        restart()
    }
    tick()

    return () => ticks = max_ticks + 1
}


let loop = GLib.MainLoop.new(null, false)
let finished = []
let err = null

let done = (num, ok) => {
    finished.push(num)
    if (!ok) err = new Error(`testPipes failed`)
    if (!ok || hooks.length == finished.length) {
        hooks.forEach(h => h())
        loop.quit()
    }
}

let hooks = [
    testPipes(1, done),
    testRestart(2, done),
]

loop.run()
if (err) throw err
