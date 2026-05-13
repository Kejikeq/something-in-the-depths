export class LiftManager {
    public y: number = 0;
    public targetY: number = 0;

    constructor() {}

    toggle() {
        const nextTarget = Math.abs(this.targetY) < 50 ? -149.0 : 0.0;
        this.targetY = nextTarget;
        return nextTarget;
    }

    update(dt: number, liftSpeed: number): number {
        let liftDeltaY = 0;
        if (Math.abs(this.y - this.targetY) > 0.01) {
            const maxDelta = Math.abs(this.targetY - this.y);
            liftDeltaY = Math.sign(this.targetY - this.y) * Math.min(liftSpeed * dt, maxDelta);
            this.y += liftDeltaY;
        } else {
            this.y = this.targetY;
        }
        return liftDeltaY;
    }
}
