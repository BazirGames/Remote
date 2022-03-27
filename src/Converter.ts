//number toFixed
export function toFixedNumber(num: number, digits: number = 0, base: number = 10) {
    const pow = math.pow(base, digits);
    return math.round(num * pow) / pow;
}

//number to storage space
export function numberToStorageSpace(number: number): string {
    if (number < 1024) {
        return number + "B";
    } else if (number < 1024 * 1024) {
        return toFixedNumber((number / 1024), 2) + "KB";
    } else if (number < 1024 * 1024 * 1024) {
        return toFixedNumber((number / 1024 / 1024), 2) + "MB";
    } else {
        return toFixedNumber((number / 1024 / 1024 / 1024), 2) + "GB";
    }
}
