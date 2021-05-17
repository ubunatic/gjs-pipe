
gi = imports.gi
const { Gio, GLib } = gi

/** @type {import('../lib/gjspipe/pipe.js')} */
const { Pipe, AGG, setTimeout, clearTimeout } = imports.gjspipe.pipe

let prog = imports.system.programInvocationName
let here = GLib.path_get_dirname(prog)
let bash = ['bash', '-o', 'errexit', '-o', 'pipefail', '-c']
const Seconds = 1e6

function testPipes(num, done) {
    let ticks = 0
    let max_ticks = 1000

    let gpu_top = `for i in $(seq 100); do cat ${here}/intel_gpu_top.json; done`
    let script  = `for i in 1 2 3; do echo $i; done`  // sleep required to get output before exit
    let pipe1   = new Pipe(...bash, gpu_top).configure({agg_type: AGG.JSON})
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
        if (res.length < 10)     return setTimeout(tick, 10)  // wait for pipe1
        if (num_lines < 3)       return setTimeout(tick, 10)  // wait for pipe2

        log(`got ${res.length} results and ${num_lines} lines after ${ticks} ticks`)
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

    let kill = () => { ticks = max_ticks + 1; cancel() }
    return kill
}

function testToggle(num, done) {
    const script = 'while true; do sleep 0.01; echo "example"; done'
    const p = new Pipe('bash', '-c', script)
    let cancel = null
    let n = 0, source = null

    function onResult(line) {
        print('toggle', n, line)
    }

    function onExit(ok) {
        if (ok) log(`pipe ${script} stopped`)
        else    logError(new Error(`pipe ${script} failed, see logs for details`))
    }

    function toggle() {
        if (cancel) { cancel(); cancel = null }
        else        { n++; cancel = p.start(onResult, onExit) }
    }

    toggle()                // turn on now
    setTimeout(toggle, 50)  // turn off later
    setTimeout(toggle, 100) // turn on later
    setTimeout(toggle, 150) // turn off later

    function kill() {
        // TODO: check pipe status and return a real test result!
        if (cancel) cancel()
        done(num, true)
    }

    setTimeout(kill, 200)
    return kill
}

function testCommand(num, done) {
    let p = new Pipe('bash', '-c', 'echo 1')
    let line = null
    let err  = null
    cancel = p.start((l) => line = l, (ok) => {
        if (!ok)         err = new Error(`command test failed`)
        if (line != '1') err = new Error(`command test bad result line=${line} expected '1'`)
        if (err == null) {
            log('command test OK')
            done(num, true)
        } else {
            logError(err)
            done(num, false)
        }
    })
    return cancel
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
    testToggle(3, done),
    testCommand(4, done),
]

loop.run()
if (err) throw err
