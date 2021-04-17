# GjsPipe

![GjsPipe Logo](gjspipe.svg)

[GjsPipe](https://github.com/ubunatic/gjs-pipe) provides utilities to safely manage your [Gio.Subprocess](https://gjs-docs.gnome.org/gio20~2.66p/gio.subprocess).


The library provides a [Pipe](lib/gjspipe/pipe.js) class for easily and safely creating
processes in your `gjs` application and consuming the process
output line by line.

## Basic Usage
```js
    // define a process to run a script in your system
    let p = new Pipe('bash', '-c', 'while sleep 1; do echo "looping"; done')

    // start the process and start reading output line by line
    let cancel = p.start(onResult)

    // if required, stop the pipe using the cancel function
    cancel()

    // That's all!
```

**WARNING**: You must call `cancel` before exiting your `gjs` app to avoid zombies!

Otherwise you may have orphaned processes in your system, since `gjs` does not
ensure they are killed automatically on program exit.

## Complete Usage Example
Often you want to turn a system program on and off and consume its output. Here is how:
```js
    const script = 'my-command'
    const p = new Pipe('bash', '-c', script)
    let cancel = null

    function onResult(line) {
        print(line)
    }

    function onExit(ok) { 
        if (ok) log(`pipe ${script} stopped`)
        else    logError(new Error(`pipe ${script} failed, see logs for details`))
    }

    function onError(err) {
        logError(err)
        if (cancel) {
            log(`pipe ${script} had errors, stopping pipe...`)
            cancel()
        }
    }

    function toggle() {
        if (cancel) { cancel(); cancel = null }
        else        { cancel = p.start(onResult, onExit, onError) }
    }

    toggleBtn.connect('toggled', (btn) => toggle())
```

The `onExit` and `onError` callbacks are optional.

* Without `onError` and errors will be logged via `logError`.
* Without `onExit` the pipe may exit and fail silently.


## Async Features

The library also provides `asyncTimeout` to `makeAsync` for running and `await`ing
any function asynchronously.

### Async Execution of Gio/GLib Functions

Async [Gio](https://gjs-docs.gnome.org/gio20~2.66p/) and
[Glib](https://gjs-docs.gnome.org/glib20~2.66.1/) functions
 usually consist of a `<func>_async` and a `<func>_finish` for calling and handling
async IO. They do not return a `Promise` and thus cannot be `await`ed.

GjsPipe provides **`glibAsync`** to mitigate this.

Instead of callback-based execution, where errors may get lost in async nirvana:
```js
const ctx = new Gio.Cancellable()
proc.wait_check_async(ctx, (_, res) => {
    try {
        const ok = proc.wait_check_finish(res)
    } catch (e) {
        // errors must be handled in the async handler functions
        // and somehow be exposed the call-level if required
    }    
}
```

You can now use `async` and `await` and have errors thrown to where you started the execution:
```js
try {
    const ctx = new Gio.Cancellable()
    const ok = await glibAsync(
        (finish) => proc.wait_check_async(ctx, finish),  // passthrough glibAsync finish func
        (_, res) => proc.wait_check_finish(res),         // handle all GLib async results
    )
} catch (e) {
    // errors can handled at the call-level of the async function
}
```

## License
MIT