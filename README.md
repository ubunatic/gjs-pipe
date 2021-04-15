# GjsPipe Wrapper for Gio.Subprocess

This library provides an `imports.gjspipe.pipe.Pipe` class that allows you to
easily and safely create processes from your `gjs` application and consume the process
output line by line.

## Basic Usage
```js
    // define a process that should run a loop in `bash`
    let p = new Pipe('bash', '-c', 'while sleep 1; do echo "looping"; done')

    // start the process and start reading output line by line
    let cancel = p.start(onResult, onExit) 

    // ... some time later ...
    
    // stop the pipe using the cancel function
    cancel()

    // That's all!
```

**WARINIG**: You must call `cancel` before exiting your `gjs` app to avoid zombies!

Otherwise you will have orphaned processes in your system, since `gjs` does not
ensure they are killed automatically on program exit.

## Advanced Usage Example
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

    function toggle() {
        if (cancel) { cancel(); cancel = null }
        else        { cancel = p.start(onResult, onExit) }
    }

    toggleBtn.connect('toggled', (btn) => toggle())
```

## License
MIT