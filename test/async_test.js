
const { Gio, GLib } = imports.gi

const { makeAsync, glibAsync, asyncTimeout } = imports.gjspipe.pipe

const isCancelled = (err) => (
    err instanceof Gio.IOErrorEnum &&
    err.code == Gio.IOErrorEnum.CANCELLED
)

let launcher = new Gio.SubprocessLauncher({
    flags: (
        Gio.SubprocessFlags.STDOUT_PIPE |
        Gio.SubprocessFlags.STDERR_PIPE
    )
})

function Stream(proc) {
    return new Gio.DataInputStream({
        base_stream: proc.get_stdout_pipe(),
        close_base_stream: true
    })
}

async function testScript(ctx, name, script, timeout_ms=300) {
    let proc = launcher.spawnv(['bash', '-c', script])
    let stdout = Stream(proc)

    let i = 0
    let terminated = false
    let cancel_requested = false
    let read_error = null
    let proc_error = null
    let finish_ok = null
    let read_ctx = new Gio.Cancellable()

    /** check process status and return if pipe was successful or not */
    async function finish() {
        let ok = false
        try {
            ok = await glibAsync(
                (finish) => proc.wait_check_async(null, finish),
                (_, res) => proc.wait_check_finish(res),
            )
        } catch (err) {
            proc_error = err
        }
        if (read_error) logError(read_error)
        if (cancel_requested) {
            // ignore exit codes when process was killed by user
            ok = read_error? false : true
        } else {
            if (proc_error) logError(proc_error)
            ok = !ok || read_error || proc_error? false : true
        }
        return ok
    }

    function cancel(){
        // no manual cancellation need, pipe is already stopping
        if (terminated) return
        log(`test ${name} cancel requested`)
        cancel_requested = true
        read_ctx.cancel()
        proc.force_exit()
    }

    /** allow early termination of the pipe */
    if (ctx) ctx.connect(cancel)

    const cancelLater = asyncTimeout(cancel, timeout_ms)

    try {
        log(`test ${name} started`)

        while (true) {
            try {
                let line = await glibAsync(
                    (finish) => stdout.read_line_async(GLib.PRIORITY_LOW, read_ctx, finish),
                    (_, res) => stdout.read_line_finish_utf8(res)[0],
                )
                if (line == null) break
                if (show_output) print('read', name, 'line:', i++, line)
            } catch (e) {                
                if (!isCancelled(e)) read_error = e
                break
            }
        }
        terminated = true
        finish_ok = await finish()
    } catch(e) {
        logError(e)
        cancel()
    }

    await cancelLater
    return { cancel_requested, terminated, finish_ok }
}

let loop = GLib.MainLoop.new(null, false)
let ctx = new Gio.Cancellable()
let errors = []
let show_output = false
let run_sudo_test = ARGV.includes('--sudo')

async function sudo_test(results, expected) {
    results.sudo = await testScript(ctx, 'sudo', 'sudo -n intel_gpu_top -J -s 100')
    expected.sudo = { cancel_requested:true, terminated:true, finish_ok:true }
}

async function runTests() {
    const results = {
        loop:  await testScript(ctx, 'loop', 'while true; do sleep 0.1; echo 1; done'),
        error: await testScript(ctx, 'error', 'sleep 0.1 && exit 1'),
        cmd:   await testScript(ctx, 'cmd', 'for i in 1 2 3; do echo $i; done'),
        ma1:   await makeAsync(() => 1),
        ma2:   await makeAsync(() => 1, 100),
    }
    const expect = {
        loop:  { cancel_requested:true, terminated:true, finish_ok:true },        
        error: { cancel_requested:false, terminated:true, finish_ok:false },
        cmd:   { cancel_requested:false, terminated:true, finish_ok:true },
        ma1: 1,
        ma2: 1,
    }
    if (run_sudo_test) await sudo_test(results, expect)

    for (const k in expect) {
        const r = JSON.stringify(results[k])
        const e = JSON.stringify(expect[k])
        if (e == r) log(`test ${k} OK`)
        else {
            errors.push(k)
            log(`test ${k} FAILED`)
            logError(new Error(`test ${k}: got ${r}, expected ${e}`))
        }
    }
}

runTests()
.then(() => loop.quit())
.catch((e) => { loop.quit(); throw e })

loop.run()
if (errors.length > 0) {
    log(`${errors.length} test(s) failed: "${errors.join('", "')}"`)
    imports.system.exit(1)    
}
